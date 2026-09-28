"""Excel 导出 API。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..services import models_dao as dao
from ..services import exporter
from ..services.i18n import normalize, tr
from ..services.template_store import normalize_text

router = APIRouter(prefix="/api/export", tags=["export"])


def _xlsx_response(data: bytes, filename: str) -> StreamingResponse:
    """下载响应；最终文件名 = 原名 + 导出时间（yyyyMMdd-HHmmss）。

    例如「逄瑞芝.xlsx」→「逄瑞芝-20260917-153012.xlsx」。
    """
    stem, dot, ext = (filename or "checkup.xlsx").rpartition(".")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"{stem}-{stamp}.{ext}" if dot else f"{stem}-{stamp}"
    # 旧浏览器只认 ASCII 的 filename，中文名时退化为通用名
    ascii_fallback = name if name.isascii() else f"checkup-{stamp}.xlsx"
    headers = {
        "Content-Disposition": (f'attachment; filename="{ascii_fallback}";'
                                f" filename*=UTF-8''{quote(name)}"),
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    return StreamingResponse(iter([data]), headers=headers, media_type=headers["Content-Type"])


def _patient_tag(patient_id: Optional[int]) -> str:
    """导出文件名里的患者标识：有患者用姓名，否则用"全部患者"。"""
    if patient_id:
        p = dao.get_patient(patient_id)
        if p and (p.get("name") or "").strip():
            return p["name"].strip()
    return "全部患者"


@router.get("/results.xlsx")
def export_results(patient_id: Optional[int] = Query(None), item: Optional[str] = Query(None),
                   report_type: Optional[str] = Query(None), date_from: Optional[str] = Query(None),
                   date_to: Optional[str] = Query(None), lang: Optional[str] = Query(None)):
    data = exporter.export_results_xlsx(patient_id, item, report_type, date_from, date_to, lang)
    return _xlsx_response(data, f"{_patient_tag(patient_id)}.xlsx")


@router.get("/items.xlsx")
def export_items(patient_id: int = Query(...), items: str = Query(...),
                 lang: Optional[str] = Query(None)):
    """批量导出多个检验项目的历次序列（项目名用 | 分隔，避免名称自带逗号）。"""
    lng = normalize(lang)
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(lng, "patient.notFound"))
    names = [x.strip() for x in items.split("|") if x.strip()]
    if not names:
        raise HTTPException(400, tr(lng, "export.noItems"))
    data = exporter.export_items_xlsx(patient_id, names, lang)
    return _xlsx_response(data, f"{_patient_tag(patient_id)}.xlsx")


@router.post("/items.xlsx")
def export_items_post(payload: dict = Body(...)):
    """批量导出（POST 版）：项目较多时用 JSON 传参，避免 URL 过长。"""
    lng = normalize((payload or {}).get("lang"))
    patient_id = int((payload or {}).get("patient_id") or 0)
    if not patient_id or not dao.get_patient(patient_id):
        raise HTTPException(404, tr(lng, "patient.notFound"))
    names = [str(x).strip() for x in ((payload or {}).get("items") or []) if str(x).strip()]
    if not names:
        raise HTTPException(400, tr(lng, "export.noItems"))
    data = exporter.export_items_xlsx(patient_id, names, lng)
    return _xlsx_response(data, f"{_patient_tag(patient_id)}.xlsx")


@router.get("/trend.xlsx")
def export_trend(patient_id: int, item: str = Query(...), lang: Optional[str] = Query(None)):
    lng = normalize(lang)
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(lng, "patient.notFound"))
    norm = normalize_text(item)
    if not dao.trend_series(patient_id, norm):
        raise HTTPException(404, tr(lng, "trend.noData"))
    data = exporter.export_trend_xlsx(patient_id, norm, lang)
    return _xlsx_response(data, f"{_patient_tag(patient_id)}.xlsx")


# ---------------------------------------------------------------------------
# 常用导出项目组（批量导出弹窗里的"常用导出"）
# ---------------------------------------------------------------------------
@router.get("/presets")
def list_presets():
    return {"items": dao.list_export_presets()}


@router.post("/presets")
def create_preset(payload: dict = Body(default={})):
    lng = normalize((payload or {}).get("lang"))
    name = ((payload or {}).get("name") or "").strip()
    items = [str(x).strip() for x in ((payload or {}).get("items") or []) if str(x).strip()]
    if not name:
        raise HTTPException(400, tr(lng, "preset.needName"))
    if not items:
        raise HTTPException(400, tr(lng, "preset.needItems"))
    return dao.create_export_preset(name, items)


@router.put("/presets/{preset_id}")
def update_preset(preset_id: int, payload: dict = Body(default={})):
    body = payload or {}
    items = None
    if body.get("items") is not None:
        items = [str(x).strip() for x in body["items"] if str(x).strip()]
    ok = dao.update_export_preset(preset_id, (body.get("name") or None), items)
    if not ok:
        raise HTTPException(404, tr(normalize(body.get("lang")), "preset.notFound"))
    return {"ok": True}


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int):
    dao.delete_export_preset(preset_id)
    return {"ok": True}
