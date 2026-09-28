"""校对中心 API：待校对列表、详情（含原文/页图）、确认入库、跳过、换模板重解析。"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from ..services import models_dao as dao
from ..services import parser as parser_mod
from ..services import pdf_service
from ..services.archive import archive
from ..services.i18n import tr
from ..services.ingestion import rel_abs
from ..services.template_store import default_store

router = APIRouter(prefix="/api/review", tags=["review"])

FLAG_TEXT = {"high": "偏高", "low": "偏低", "normal": ""}


@router.get("")
def list_review(status: str = Query("pending"), q: Optional[str] = None,
                offset: int = 0, limit: int = Query(30, le=200)):
    return dao.list_reviews(status, offset, limit, q)


@router.get("/{review_id}")
def review_detail(review_id: int):
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, tr(None, "review.notFound"))
    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    item["task"] = task
    pages_total = (task or {}).get("pages_total") or 1
    item["pages_total"] = max(1, pages_total)
    return item


@router.get("/{review_id}/page/{page_index}")
def review_page_image(review_id: int, page_index: int):
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, tr(None, "review.notFound"))
    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    if not task:
        raise HTTPException(404, "找不到源文件")
    path = rel_abs(task["stored_path"])
    if not path.exists():
        raise HTTPException(404, "源文件缺失")
    if task["kind"] == "image":
        return FileResponse(str(path), media_type="image/png")
    md5 = task.get("md5") or pdf_service.file_md5(path)
    dao.update_task(task["id"], md5=md5)
    png = pdf_service.render_pdf_page_png_deterministic(path, page_index, md5)
    return FileResponse(str(png), media_type="image/png")


@router.post("/{review_id}/confirm")
def confirm_review(review_id: int, payload: dict = Body(...)):
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, tr(None, "review.notFound"))
    if item["status"] == "confirmed":
        raise HTTPException(400, "该记录已确认入库")
    if item["status"] == "skipped":
        dao.update_review(review_id, status="pending")

    candidate = item.get("parsed") or {}
    patient_name = (payload.get("patient_name") or item.get("patient_name") or "").strip()
    if not patient_name:
        raise HTTPException(400, tr(None, "review.nameRequired"))
    gender = payload.get("gender") or item.get("gender") or None
    birth_date = payload.get("birth_date") or item.get("birth_date") or None
    report_date = payload.get("report_date") or item.get("report_date") or None
    report_type = payload.get("report_type") or item.get("report_type") or "检验"
    hospital = payload.get("hospital") or item.get("hospital") or None

    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    try:
        report = archive(
            candidate,
            filename=item.get("filename") or "",
            stored_path=(task or {}).get("stored_path") or "",
            md5=(task or {}).get("md5") or "",
            task_id=item.get("task_id"), batch_id=item.get("batch_id"),
            raw_text=item.get("raw_text") or "",
            overrides={
                "patient_name": patient_name, "gender": gender, "birth_date": birth_date,
                "report_date": report_date, "report_type": report_type, "hospital": hospital,
                "items": payload.get("items"),
                "template_id": item.get("template_id"), "template_name": item.get("template_name"),
            },
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    dao.update_review(review_id, status="confirmed", report_id=report["id"],
                      patient_id=report["patient_id"], patient_name=patient_name,
                      gender=gender, birth_date=birth_date, report_date=report_date,
                      report_type=report_type, hospital=hospital)
    if task:
        dao.update_task(task["id"], status="done")
        dao.refresh_batch(task["batch_id"])
    return report


@router.post("/{review_id}/skip")
def skip_review(review_id: int):
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, tr(None, "review.notFound"))
    dao.update_review(review_id, status="skipped")
    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    if task:
        dao.refresh_batch(task["batch_id"])
    return {"ok": True}


@router.post("/{review_id}/reparse")
def reparse(review_id: int, payload: dict = Body(default={})):
    """换模板重新解析：优先使用 OCR/文本页缓存。"""
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, tr(None, "review.notFound"))
    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    if not task:
        raise HTTPException(400, tr(None, "report.sourceMissing"))
    path = rel_abs(task["stored_path"])
    md5 = task.get("md5") or pdf_service.file_md5(path)
    if not task.get("md5"):
        dao.update_task(task["id"], md5=md5)

    pages = _load_pages(task, md5)
    raw_text = "\n".join(ln.text for page in pages for ln in page)
    template_id = payload.get("template_id")
    template = default_store.get(template_id) if template_id else default_store.best_match(raw_text)
    candidate = parser_mod.parse_document(pages, template, raw_text,
                                          source_name=item.get("filename"))
    dao.update_review(
        review_id,
        template_id=(template or {}).get("id") if template else None,
        template_name=(template or {}).get("name") if template else None,
        parsed_json=json.dumps(candidate, ensure_ascii=False, default=str),
        patient_name=candidate.get("patient_name"), gender=candidate.get("gender"),
        birth_date=candidate.get("birth_date"), report_date=candidate.get("report_date"),
        report_type=candidate.get("report_type"), hospital=candidate.get("hospital"),
        confidence=candidate.get("confidence"), status="pending",
    )
    return candidate


def _load_pages(task: dict, md5: str):
    from ..services.ingestion import extract_pages

    path = rel_abs(task["stored_path"])
    return extract_pages(path, task["kind"], md5)


def _extract(task: dict):
    from ..services import ingestion

    return ingestion._extract_all_lines(task)  # noqa: SLF001

