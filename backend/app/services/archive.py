"""报告入库：把解析候选写入患者库。

供两条路径共用：
  - 导入后自动入库（识别质量达标时直接归档，无需人工确认）；
  - 待核对记录 / 患者库报告编辑后保存。
"""
from __future__ import annotations

from typing import Optional

from . import models_dao as dao
from . import parser as parser_mod
from .patient_matcher import resolve_patient


def finalize_item(it: dict) -> dict:
    """依据表单回传字段计算数值/参考范围/异常标记。"""
    raw_value = str(it.get("value_text", "") or "").strip()
    value_text, value_num, hint = parser_mod.parse_value_cell(raw_value)
    ref_text = str(it.get("ref_text", "") or "").strip()
    ref_text, ref_low, ref_high, _ = parser_mod.parse_ref_cell(ref_text)
    unit = str(it.get("unit", "") or "").strip()
    explicit = str(it.get("flag", "") or "").strip().lower()
    hint2 = parser_mod._flag_from_text(str(it.get("flag_text", "") or ""))  # noqa: SLF001
    if explicit in ("high", "low"):
        hint2 = explicit
    flag = parser_mod._compute_flag(value_num, ref_low, ref_high, hint2 or hint)  # noqa: SLF001
    return {
        "item": str(it.get("item", "") or "").strip(),
        "value_text": value_text,
        "value_num": value_num,
        "unit": unit,
        "ref_text": ref_text,
        "ref_low": ref_low,
        "ref_high": ref_high,
        "flag": flag,
    }


def archive(candidate: dict, *, filename: str, stored_path: str = "", md5: str = "",
            task_id: Optional[int] = None, batch_id: Optional[int] = None,
            raw_text: str = "", overrides: Optional[dict] = None) -> dict:
    """写入一份报告（自动归集患者）。overrides 优先于 candidate。"""
    cand = candidate or {}
    ov = overrides or {}

    name = (ov.get("patient_name") or cand.get("patient_name") or "").strip()
    if not name:
        raise ValueError("缺少患者姓名，无法入库")
    gender = ov.get("gender") or cand.get("gender") or None
    birth = ov.get("birth_date") or cand.get("birth_date") or None
    report_date = ov.get("report_date") or cand.get("report_date") or None
    report_type = ov.get("report_type") or cand.get("report_type") or "检验"
    hospital = ov.get("hospital") or cand.get("hospital") or None

    raw_items = ov.get("items")
    if raw_items is None:
        raw_items = cand.get("items") or []
    items = [finalize_item(i) for i in raw_items]
    items = [i for i in items if i["item"]]

    with dao.get_conn() as conn:
        patient_id, _ = resolve_patient(conn, name, gender or None, birth or None)

    meta = {
        "template_id": ov.get("template_id") or cand.get("template_id"),
        "template_name": ov.get("template_name") or cand.get("template_name"),
        "report_date": report_date,
        "report_type": report_type,
        "hospital": hospital,
    }
    report_id = dao.create_report(
        patient_id=patient_id, task_id=task_id, batch_id=batch_id,
        source_filename=filename or "", stored_path=stored_path or "", md5=md5 or "",
        meta=meta, raw_text=raw_text, items=items,
    )
    dao.log_activity("archive", "log.archive", {
        "file": filename or str(report_id), "patient": name, "n": len(items)})
    return dao.get_report(report_id)


def update_report(report_id: int, payload: dict) -> dict:
    """编辑已入库报告：更新元信息、检验结果，并按姓名重新归集患者。"""
    report = dao.get_report(report_id)
    if not report:
        raise ValueError("报告不存在")
    name = (payload.get("patient_name") or "").strip()
    if not name:
        raise ValueError("请填写患者姓名")
    gender = payload.get("gender") or None
    birth = payload.get("birth_date") or None
    raw_items = payload.get("items")
    if raw_items is None:
        raw_items = report.get("results") or []
    items = [finalize_item(i) for i in raw_items]
    items = [i for i in items if i["item"]]

    with dao.get_conn() as conn:
        patient_id, _ = resolve_patient(conn, name, gender, birth)

    meta = {
        "template_id": report.get("template_id"),
        "template_name": report.get("template_name"),
        "report_date": payload.get("report_date") or report.get("report_date"),
        "report_type": payload.get("report_type") or report.get("report_type") or "检验",
        "hospital": payload.get("hospital") or report.get("hospital"),
    }
    dao.replace_report_content(report_id, patient_id, meta,
                               report.get("raw_text") or "", items)
    dao.log_activity("edit", "log.edit", {
        "file": report.get("source_filename") or str(report_id),
        "patient": name, "n": len(items)})
    return dao.get_report(report_id)
