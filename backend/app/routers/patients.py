"""患者档案 API：列表/详情/新建/编辑/合并/删除。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..services import models_dao as dao
from ..services.i18n import tr

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("")
def list_patients(q: Optional[str] = Query(None), offset: int = 0, limit: int = Query(200, le=1000)):
    return dao.list_patients(q, offset, limit)


@router.post("")
def create_patient(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, tr(None, "patient.nameRequired"))
    pid = dao.create_patient(name, payload.get("gender") or None,
                             payload.get("birth_date") or None, payload.get("note") or None)
    dao.log_activity("patient", "log.patientNew", {"name": name})
    return dao.get_patient(pid)


@router.get("/{patient_id}")
def patient_detail(patient_id: int):
    p = dao.get_patient(patient_id)
    if not p:
        raise HTTPException(404, tr(None, "patient.notFound"))
    return p


@router.put("/{patient_id}")
def edit_patient(patient_id: int, payload: dict):
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(None, "patient.notFound"))
    dao.update_patient(
        patient_id,
        name=payload.get("name"),
        gender=payload.get("gender"),
        birth_date=payload.get("birth_date"),
        note=payload.get("note"),
    )
    return dao.get_patient(patient_id)


@router.post("/{patient_id}/merge")
def merge_into(patient_id: int, payload: dict):
    """把 remove_id 的患者档案并入 patient_id。"""
    remove_id = payload.get("remove_id")
    if not remove_id or int(remove_id) == int(patient_id):
        raise HTTPException(400, tr(None, "patient.mergeInvalid"))
    if not dao.get_patient(patient_id) or not dao.get_patient(int(remove_id)):
        raise HTTPException(404, tr(None, "patient.notFound"))
    dao.merge_patients(int(patient_id), int(remove_id))
    dao.log_activity("merge", "log.merge", {
        "from": int(remove_id), "to": dao.get_patient(patient_id)["name"]})
    return dao.get_patient(patient_id)


@router.delete("/{patient_id}")
def remove_patient(patient_id: int, with_reports: bool = Query(False)):
    """删除患者档案。with_reports=true 时同时删除其名下的报告。"""
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(None, "patient.notFound"))
    dao.delete_patient(patient_id, with_reports=with_reports)
    dao.log_activity("delete",
                     "log.deletePatientWithReports" if with_reports else "log.deletePatient",
                     {"id": patient_id})
    return {"ok": True}


@router.get("/{patient_id}/reports")
def patient_reports(patient_id: int, offset: int = 0, limit: int = 200):
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(None, "patient.notFound"))
    if not 0 < limit <= 1000:
        raise HTTPException(422, "limit 需在 1-1000 之间")
    return dao.list_reports(patient_id=patient_id, offset=offset, limit=limit)


@router.get("/{patient_id}/items")
def patient_items(patient_id: int):
    if not dao.get_patient(patient_id):
        raise HTTPException(404, tr(None, "patient.notFound"))
    return dao.patient_items(patient_id)
