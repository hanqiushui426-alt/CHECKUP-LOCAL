"""Excel 导出 API。"""
from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..services import models_dao as dao
from ..services import exporter
from ..services.i18n import normalize, tr
from ..services.template_store import normalize_text

router = APIRouter(prefix="/api/export", tags=["export"])


def _xlsx_response(data: bytes, filename: str) -> StreamingResponse:
    headers = {
        "Content-Disposition": f"attachment; filename=\"export.xlsx\"; filename*=UTF-8''{quote(filename)}",
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    return StreamingResponse(iter([data]), headers=headers, media_type=headers["Content-Type"])


@router.get("/results.xlsx")
def export_results(patient_id: Optional[int] = Query(None), item: Optional[str] = Query(None),
                   report_type: Optional[str] = Query(None), date_from: Optional[str] = Query(None),
                   date_to: Optional[str] = Query(None), lang: Optional[str] = Query(None)):
    data = exporter.export_results_xlsx(patient_id, item, report_type, date_from, date_to, lang)
    return _xlsx_response(data, "checkup-results.xlsx")


@router.get("/trend.xlsx")
def export_trend(patient_id: int, item: str = Query(...), lang: Optional[str] = Query(None)):
    lng = normalize(lang)
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(lng, "patient.notFound"))
    norm = normalize_text(item)
    if not dao.trend_series(patient_id, norm):
        raise HTTPException(404, tr(lng, "trend.noData"))
    data = exporter.export_trend_xlsx(patient_id, norm, lang)
    return _xlsx_response(data, "checkup-trend.xlsx")
