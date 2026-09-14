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
    """依据表单回传字段计算数值/参考范围/异常标记。

    flag 语义：
      "normal" / "high" / "low" —— 人工指定，直接采用；
      "auto" / 空                —— 交给参考范围与文本提示自动判断。
    """
    raw_value = str(it.get("value_text", "") or "").strip()
    value_text, value_num, hint = parser_mod.parse_value_cell(raw_value)
    ref_text = str(it.get("ref_text", "") or "").strip()
    ref_text, ref_low, ref_high, _ = parser_mod.parse_ref_cell(ref_text)
    unit = str(it.get("unit", "") or "").strip()
    explicit = str(it.get("flag", "") or "").strip().lower()
    if explicit in ("normal", "high", "low"):
        flag = explicit
    else:
        hint2 = parser_mod._flag_from_text(str(it.get("flag_text", "") or ""))  # noqa: SLF001
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


# 参与"是否被人工改动"比较的字段
_COMPARE_TEXT_FIELDS = ("value_text", "unit", "ref_text", "flag")
_COMPARE_NUM_FIELDS = ("value_num", "ref_low", "ref_high")
_SNAPSHOT_FIELDS = _COMPARE_TEXT_FIELDS + _COMPARE_NUM_FIELDS


def _snapshot(it: dict) -> dict:
    """人工修改后的整行快照（用于重解析后恢复默认值/对比展示）。"""
    return {k: it.get(k) for k in _SNAPSHOT_FIELDS}


def _same_row(new: dict, old: dict) -> bool:
    """比较新提交行与库中旧行是否一致（用于判断是否被人工改动）。"""
    for f in _COMPARE_TEXT_FIELDS:
        if (new.get(f) or "") != (old.get(f) or ""):
            return False
    for f in _COMPARE_NUM_FIELDS:
        a, b = new.get(f), old.get(f)
        if (a is None) != (b is None):
            return False
        if a is not None and b is not None and abs(float(a) - float(b)) > 1e-9:
            return False
    return True


def mark_manual_changes(items: list[dict], old_rows: list[dict]) -> list[dict]:
    """给每个检验行打上"人工修改"留痕：

    - 与库中同项目旧行不同（或为新增行）→ manual=1，并保存修改后的快照；
    - 未改动 → 继承旧行的留痕与待确认状态。
    """
    from .template_store import normalize_text

    old_by_norm: dict[str, dict] = {}
    for r in old_rows or []:
        key = r.get("item_norm") or normalize_text(r.get("item") or "")
        old_by_norm.setdefault(key, r)

    for it in items:
        key = normalize_text(it.get("item") or "")
        old = old_by_norm.get(key)
        if old is None:
            it["manual"] = 1
            it["manual_json"] = _snapshot(it)
            continue
        if _same_row(it, old):
            it["manual"] = old.get("manual") or 0
            it["manual_json"] = old.get("manual_json")
        else:
            it["manual"] = 1
            it["manual_json"] = _snapshot(it)
        it["confirm_pending"] = old.get("confirm_pending") or 0
        it["recognized_json"] = old.get("recognized_json")
    return items


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
    # 与库中原行比较，标记哪些行是人工改过的（重解析时不再被直接覆盖）
    items = mark_manual_changes(items, report.get("results") or [])

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


def merge_reparse(old_rows: list[dict], new_items: list[dict]) -> list[dict]:
    """重解析合并策略：人工改过的行不被覆盖，改为标记"待确认"并记录新识别值。

    - 新识别到、且该行人工改过 → 保留人工值；若两者不同则 confirm_pending=1，
      并把本次识别结果存入 recognized_json 供对比；
    - 人工改过但本次未识别到 → 保留该行并同样标记待确认（recognized_json 为空）；
    - 其余行按本次识别结果写入（人工留痕清空）。
    """
    from .template_store import normalize_text

    old_by_norm: dict[str, dict] = {}
    for r in old_rows or []:
        old_by_norm.setdefault(r.get("item_norm") or normalize_text(r.get("item") or ""), r)

    def _keep_old(old: dict, confirm: bool, recognized: Optional[dict]) -> dict:
        return {
            "item": old.get("item") or "",
            "value_text": old.get("value_text") or "",
            "value_num": old.get("value_num"),
            "unit": old.get("unit") or "",
            "ref_text": old.get("ref_text") or "",
            "ref_low": old.get("ref_low"),
            "ref_high": old.get("ref_high"),
            "flag": old.get("flag") or "normal",
            "manual": 1,
            "manual_json": old.get("manual_json"),
            "confirm_pending": 1 if confirm else 0,
            "recognized_json": recognized,
        }

    used: set[str] = set()
    merged: list[dict] = []
    for it in new_items:
        key = normalize_text(it.get("item") or "")
        old = old_by_norm.get(key)
        if old is None or not old.get("manual"):
            merged.append(it)
            continue
        used.add(key)
        keep = _keep_old(old, confirm=False, recognized=None)
        if not _same_row(it, keep):
            keep = _keep_old(old, confirm=True, recognized=_snapshot(it))
        merged.append(keep)

    for key, old in old_by_norm.items():
        if key in used or not old.get("manual"):
            continue
        merged.append(_keep_old(old, confirm=True, recognized=None))

    return merged
