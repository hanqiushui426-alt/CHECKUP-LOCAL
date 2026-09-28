"""统计与趋势 API。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..services import models_dao as dao
from ..services.template_store import normalize_text

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview")
def overview():
    return dao.overview()


@router.get("/activity")
def activity(limit: int = Query(30, le=200)):
    return dao.list_activity(limit)


@router.get("/items")
def items(patient_id: int):
    if not dao.get_patient(patient_id):
        raise HTTPException(404, "患者不存在")
    return dao.patient_items(patient_id)


@router.get("/trend")
def trend(patient_id: int, item: str = Query(...)):
    """某患者某检验项目的历次数值序列。item 为该项目的归一化文本。"""
    if not dao.get_patient(patient_id):
        raise HTTPException(404, "患者不存在")
    norm = normalize_text(item)
    series = dao.trend_series(patient_id, norm)
    if not series:
        raise HTTPException(404, "该项目暂无数据（请确认已选择正确患者）")
    meta = {
        "item": series[0]["item"],
        "item_norm": norm,
        "unit": series[0]["unit"] or "",
    }
    return {"meta": meta, "series": series}


@router.get("/abnormal")
def abnormal(limit: int = Query(10, le=100)):
    return dao.abnormal_recent(limit)


@router.get("/types")
def types():
    return dao.report_types()
