"""报告与检验结果 API。"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from ..services import ingestion
from ..services import models_dao as dao
from ..services import parser as parser_mod
from ..services import pdf_service
from ..services.archive import update_report
from ..services.i18n import normalize, tr
from ..services.ingestion import rel_abs
from ..services.patient_matcher import resolve_patient
from ..services.template_store import default_store

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
def list_reports(patient_id: Optional[int] = Query(None), report_type: Optional[str] = Query(None),
                 item: Optional[str] = Query(None), date_from: Optional[str] = Query(None),
                 date_to: Optional[str] = Query(None), offset: int = 0,
                 limit: int = Query(100, le=1000)):
    return dao.list_reports(patient_id, report_type, item, date_from, date_to, offset, limit)


@router.get("/{report_id}")
def report_detail(report_id: int):
    r = dao.get_report(report_id)
    if not r:
        raise HTTPException(404, tr(None, "report.notFound"))
    return r


@router.delete("/{report_id}")
def remove_report(report_id: int):
    report = dao.get_report(report_id)
    if not report:
        raise HTTPException(404, tr(None, "report.notFound"))
    dao.delete_report(report_id)
    dao.log_activity("delete", "log.deleteReport", {
        "file": report.get("source_filename") or str(report_id),
        "patient": (report.get("patient") or {}).get("name") or "-"})
    return {"ok": True}


@router.put("/{report_id}")
def edit_report(report_id: int, payload: dict = Body(...), lang: Optional[str] = Query(None)):
    """编辑已入库报告：患者归属/日期/类型/医院 + 检验行增删改。"""
    lng = normalize(lang)
    if not dao.get_report(report_id):
        raise HTTPException(404, tr(lng, "report.notFound"))
    try:
        return update_report(report_id, payload or {})
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{report_id}/page/{page_index}")
def report_page_image(report_id: int, page_index: int):
    """报告页图，供编辑时对照原文。"""
    r = dao.get_report(report_id)
    if not r:
        raise HTTPException(404, tr(None, "report.notFound"))
    stored = r.get("stored_path") or ""
    if not stored:
        raise HTTPException(404, tr(None, "report.noSource"))
    path = rel_abs(stored)
    if not path.exists():
        raise HTTPException(404, tr(None, "report.sourceMissing"))
    if path.suffix.lower() != ".pdf":
        return FileResponse(str(path), media_type="image/png")
    md5 = r.get("md5") or pdf_service.file_md5(path)
    png = pdf_service.render_pdf_page_png_deterministic(path, page_index, md5)
    return FileResponse(str(png), media_type="image/png")


def _reparse_one(report: dict, template_id: Optional[str] = None,
                 lang: Optional[str] = None) -> dict:
    """对单份已入库报告重新抽取 + 解析，返回更新后的报告。"""
    lng = normalize(lang)
    stored = report.get("stored_path") or ""
    if not stored:
        raise HTTPException(400, tr(lng, "report.noSource"))
    path = ingestion.rel_abs(stored)
    if not path.exists():
        raise HTTPException(400, tr(lng, "report.sourceMissing"))
    md5 = report.get("md5") or pdf_service.file_md5(path)
    kind = "pdf" if path.suffix.lower() == ".pdf" else "image"
    pages = ingestion.extract_pages(path, kind, md5)
    raw_text = "\n".join(ln.text for page in pages for ln in page)

    template = default_store.get(template_id) if template_id else None
    if template is None:
        template = default_store.best_match(raw_text)
    candidate = parser_mod.parse_document(pages, template, raw_text,
                                          source_name=report.get("source_filename"))

    old_name = (report.get("patient") or {}).get("name") or ""
    name = (candidate.get("patient_name") or old_name or "").strip()
    if not name:
        raise HTTPException(400, tr(lng, "report.nameRequired"))
    with dao.get_conn() as conn:
        patient_id, _ = resolve_patient(conn, name, candidate.get("gender"),
                                        candidate.get("birth_date"))
    meta = {
        "template_id": (template or {}).get("id"),
        "template_name": (template or {}).get("name"),
        "report_date": candidate.get("report_date"),
        "report_type": candidate.get("report_type") or report.get("report_type") or "检验",
        "hospital": candidate.get("hospital"),
    }
    dao.replace_report_content(report["id"], patient_id, meta, raw_text,
                               candidate.get("items") or [])
    return dao.get_report(report["id"])


@router.post("/{report_id}/reparse")
def reparse_report(report_id: int, payload: dict = Body(default={})):
    """按当前解析规则重新识别已入库报告（修正姓名/日期/检验项）。"""
    report = dao.get_report(report_id)
    if not report:
        raise HTTPException(404, tr(None, "report.notFound"))
    result = _reparse_one(report, (payload or {}).get("template_id"))
    dao.log_activity("reparse", "log.reparseOne", {
        "file": report.get("source_filename") or str(report_id)})
    return result


@router.post("/reparse-all")
def reparse_all(payload: dict = Body(default={})):
    """批量重解析全部已入库报告，返回成功/失败统计。"""
    limit = int((payload or {}).get("limit") or 500)
    reports = dao.list_reports(limit=limit)["items"]
    ok, failed = 0, []
    for r in reports:
        try:
            _reparse_one(r, (payload or {}).get("template_id"))
            ok += 1
        except HTTPException as e:
            failed.append({"id": r["id"], "file": r["source_filename"], "reason": e.detail})
        except Exception as e:  # 单份失败不影响整体
            failed.append({"id": r["id"], "file": r["source_filename"], "reason": str(e)})
    # 清理因重解析而不再归属任何报告的空档案
    dao.delete_orphan_patients()
    dao.log_activity("reparse", "log.reparseAll", {
        "n": len(reports), "ok": ok, "failed": len(failed)})
    return {"total": len(reports), "ok": ok, "failed": failed}
