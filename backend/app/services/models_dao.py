"""SQLite 数据访问层。每个函数独立短连接，供 API / 后台线程安全调用。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from ..db import get_conn
from ..config import DATA_DIR

logger = logging.getLogger(__name__)


def _ts() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# 操作日志（工作台"最新操作"展示用）
# ---------------------------------------------------------------------------
def log_activity(kind: str, key: str, vars: dict | None = None) -> None:
    """记录关键操作。detail 存「文案键 + 参数」JSON，前端按当前语言渲染；
    日志失败不影响主流程。"""
    try:
        detail = json.dumps({"key": key, "vars": vars or {}}, ensure_ascii=False)
        with get_conn() as conn:
            conn.execute("INSERT INTO activity_log(ts,kind,detail) VALUES(?,?,?)",
                         (_ts(), kind, detail))
    except Exception:  # noqa: BLE001
        logger.debug("写操作日志失败", exc_info=True)


def list_activity(limit: int = 30) -> list[dict]:
    out: list[dict] = []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    for r in rows:
        item = {"id": r["id"], "ts": r["ts"], "kind": r["kind"]}
        d = r["detail"] or ""
        if d.startswith("{"):
            try:
                obj = json.loads(d)
                item["key"] = obj.get("key") or ""
                item["vars"] = obj.get("vars") or {}
            except Exception:
                item["raw"] = d
        else:
            item["raw"] = d  # 旧格式日志：原样显示
        out.append(item)
    return out


def rel_abs(rel_path: str | None) -> str:
    return str(DATA_DIR / rel_path) if rel_path else ""


# ---------------------------------------------------------------------------
# 批次 / 任务
# ---------------------------------------------------------------------------
def create_batch(name: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO batches(name,total_files,status,created_at) VALUES(?,0,'running',?)",
            (name, _ts()),
        )
        return cur.lastrowid


def add_import_task(batch_id: int, filename: str, stored_path: str, kind: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO import_tasks(batch_id,filename,stored_path,kind,status,created_at,updated_at) "
            "VALUES(?,?,?,?,'queued',?,?)",
            (batch_id, filename, stored_path, kind, _ts(), _ts()),
        )
        conn.execute("UPDATE batches SET total_files=total_files+1 WHERE id=?", (batch_id,))
        return cur.lastrowid


def get_task(task_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM import_tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None


def list_tasks(batch_id: Optional[int] = None, status: Optional[str] = None, limit: int = 500) -> list[dict]:
    sql = "SELECT * FROM import_tasks WHERE 1=1"
    params: list[Any] = []
    if batch_id:
        sql += " AND batch_id=?"
        params.append(batch_id)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def claim_next_task() -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM import_tasks WHERE status='queued' ORDER BY id LIMIT 1"
        ).fetchone()
        if not row:
            return None
        cur = conn.execute(
            "UPDATE import_tasks SET status='extracting',updated_at=? WHERE id=? AND status='queued'",
            (_ts(), row["id"]),
        )
        if cur.rowcount == 0:
            return None
        t = conn.execute("SELECT * FROM import_tasks WHERE id=?", (row["id"],)).fetchone()
        return dict(t)


def update_task(task_id: int, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [_ts(), task_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE import_tasks SET {keys},updated_at=? WHERE id=?", vals)


def delete_task(task_id: int) -> None:
    with get_conn() as conn:
        t = conn.execute("SELECT * FROM import_tasks WHERE id=?", (task_id,)).fetchone()
        conn.execute("DELETE FROM import_tasks WHERE id=?", (task_id,))
        if t:
            conn.execute("DELETE FROM review_items WHERE task_id=?", (task_id,))
            conn.execute(
                "UPDATE batches SET total_files=MAX(0,total_files-1) WHERE id=?", (t["batch_id"],)
            )


def list_batches(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT b.*, "
            " SUM(CASE WHEN t.status='error' THEN 1 ELSE 0 END) AS failed,"
            " SUM(CASE WHEN t.status IN ('review','done') THEN 1 ELSE 0 END) AS finished"
            " FROM batches b LEFT JOIN import_tasks t ON t.batch_id=b.id"
            " GROUP BY b.id ORDER BY b.id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def refresh_batch(batch_id: int) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) c, "
            " SUM(CASE WHEN status IN ('review','done','error') THEN 1 ELSE 0 END) fin, "
            " SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) err "
            " FROM import_tasks WHERE batch_id=?",
            (batch_id,),
        ).fetchone()
        if not row or row["c"] == 0:
            status = "empty"
        elif row["fin"] == row["c"]:
            status = "error" if row["err"] else "awaiting_review"
        else:
            status = "running"
        conn.execute("UPDATE batches SET status=?,total_files=? WHERE id=?", (status, row["c"], batch_id))


# ---------------------------------------------------------------------------
# 患者
# ---------------------------------------------------------------------------
def list_patients(q: Optional[str] = None, offset: int = 0, limit: int = 200) -> dict:
    sql = (
        "SELECT p.id,p.name,p.gender,p.birth_date,p.created_at,"
        " COUNT(r.id) AS report_count, MAX(r.report_date) AS last_date "
        " FROM patients p LEFT JOIN reports r ON r.patient_id=p.id WHERE 1=1"
    )
    params: list[Any] = []
    if q:
        sql += " AND (p.name LIKE ? OR p.name_norm LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    sql += " GROUP BY p.id ORDER BY last_date IS NULL, last_date DESC, p.id DESC"
    with get_conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) c FROM patients p LEFT JOIN reports r ON r.patient_id=p.id WHERE 1=1"
            + (f" AND (p.name LIKE ? OR p.name_norm LIKE ?)" if q else ""),
            params if q else [],
        ).fetchone()["c"]
        rows = conn.execute(sql + f" LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}


def get_patient(patient_id: int) -> Optional[dict]:
    with get_conn() as conn:
        p = conn.execute(
            "SELECT p.*, COUNT(r.id) AS report_count, MAX(r.report_date) AS last_date "
            " FROM patients p LEFT JOIN reports r ON r.patient_id=p.id WHERE p.id=? GROUP BY p.id",
            (patient_id,),
        ).fetchone()
        return dict(p) if p else None


def create_patient(name: str, gender: Optional[str] = None,
                   birth_date: Optional[str] = None, note: Optional[str] = None) -> int:
    from .patient_matcher import norm_name

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO patients(name,name_norm,gender,birth_date,note,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (name, norm_name(name), gender, birth_date, note, _ts(), _ts()),
        )
        return cur.lastrowid


def update_patient(patient_id: int, name: Optional[str] = None, gender: Optional[str] = None,
                   birth_date: Optional[str] = None, note: Optional[str] = None) -> None:
    from .patient_matcher import norm_name

    fields: list[str] = []
    params: list[Any] = []
    if name is not None:
        fields += ["name=?", "name_norm=?"]
        params += [name, norm_name(name)]
    if gender is not None:
        fields.append("gender=?")
        params.append(gender)
    if birth_date is not None:
        fields.append("birth_date=?")
        params.append(birth_date)
    if note is not None:
        fields.append("note=?")
        params.append(note)
    if not fields:
        return
    fields.append("updated_at=?")
    params += [_ts(), patient_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE patients SET {','.join(fields)} WHERE id=?", params)


def merge_patients(keep_id: int, remove_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE reports SET patient_id=? WHERE patient_id=?", (keep_id, remove_id))
        conn.execute("UPDATE review_items SET patient_id=? WHERE patient_id=?", (keep_id, remove_id))
        conn.execute("DELETE FROM patients WHERE id=?", (remove_id,))


def delete_patient(patient_id: int, with_reports: bool = False) -> None:
    with get_conn() as conn:
        if with_reports:
            conn.execute("DELETE FROM reports WHERE patient_id=?", (patient_id,))
        else:
            conn.execute(
                "UPDATE reports SET patient_id=NULL WHERE patient_id=?", (patient_id,)
            )
        conn.execute("DELETE FROM patients WHERE id=?", (patient_id,))


def delete_orphan_patients() -> int:
    """删除没有任何报告的档案（重解析后遗留的空档案）。"""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM patients WHERE id NOT IN "
            "(SELECT DISTINCT patient_id FROM reports WHERE patient_id IS NOT NULL)"
        )
        return cur.rowcount or 0


# ---------------------------------------------------------------------------
# 报告 / 检验结果
# ---------------------------------------------------------------------------
def report_exists_by_md5(md5: str) -> Optional[int]:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM reports WHERE md5=? LIMIT 1", (md5,)).fetchone()
        return row["id"] if row else None


def create_report(patient_id: int, task_id: Optional[int], batch_id: Optional[int],
                  source_filename: str, stored_path: str, md5: str,
                  meta: dict, raw_text: str, items: list[dict]) -> int:
    report_type = meta.get("report_type") or ""
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO reports(patient_id,batch_id,task_id,source_filename,stored_path,"
            "template_id,template_name,report_date,report_type,hospital,raw_text,md5,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                patient_id, batch_id, task_id, source_filename, stored_path,
                meta.get("template_id"), meta.get("template_name"),
                meta.get("report_date"), report_type, meta.get("hospital"),
                raw_text, md5, _ts(),
            ),
        )
        report_id = cur.lastrowid
        from .template_store import normalize_text

        for i, it in enumerate(items):
            item = it.get("item", "") or ""
            conn.execute(
                "INSERT INTO results(report_id,item,item_norm,value_text,value_num,unit,ref_text,"
                "ref_low,ref_high,flag,seq,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    report_id, item, normalize_text(item),
                    it.get("value_text", "") or "", it.get("value_num"),
                    it.get("unit") or "", it.get("ref_text") or "",
                    it.get("ref_low"), it.get("ref_high"), it.get("flag", "normal") or "normal", i, _ts(),
                ),
            )
        return report_id


def get_report(report_id: int) -> Optional[dict]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if not r:
            return None
        out = dict(r)
        out["results"] = [dict(x) for x in conn.execute(
            "SELECT * FROM results WHERE report_id=? ORDER BY seq", (report_id,)
        ).fetchall()]
        if out["patient_id"]:
            p = conn.execute("SELECT name,gender,birth_date FROM patients WHERE id=?",
                             (out["patient_id"],)).fetchone()
            out["patient"] = dict(p) if p else None
        return out


def list_reports(patient_id: Optional[int] = None, report_type: Optional[str] = None,
                 item: Optional[str] = None, date_from: Optional[str] = None,
                 date_to: Optional[str] = None, offset: int = 0, limit: int = 100) -> dict:
    sql = (
        "SELECT r.*, p.name AS patient_name, p.gender AS patient_gender,"
        " (SELECT COUNT(*) FROM results s WHERE s.report_id=r.id) AS result_count "
        " FROM reports r LEFT JOIN patients p ON p.id=r.patient_id WHERE 1=1"
    )
    params: list[Any] = []
    if patient_id:
        sql += " AND r.patient_id=?"
        params.append(patient_id)
    if report_type:
        sql += " AND r.report_type=?"
        params.append(report_type)
    if item:
        sql += " AND r.id IN (SELECT report_id FROM results WHERE item_norm LIKE ?)"
        params.append(f"%{item}%")
    if date_from:
        sql += " AND r.report_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND r.report_date<=?"
        params.append(date_to)
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM reports r WHERE 1=1" + (
            " AND r.patient_id=?" if patient_id else ""
        ), [patient_id] if patient_id else []).fetchone()["c"]
        rows = conn.execute(sql + " ORDER BY r.report_date DESC, r.id DESC LIMIT ? OFFSET ?",
                            (*params, limit, offset)).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}


def delete_report(report_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM reports WHERE id=?", (report_id,))


def replace_report_content(report_id: int, patient_id: Optional[int], meta: dict,
                           raw_text: str, items: list[dict]) -> None:
    """重解析后整体替换报告元信息与检验结果（保留 id/来源文件/创建时间）。"""
    from .template_store import normalize_text

    with get_conn() as conn:
        conn.execute(
            "UPDATE reports SET patient_id=?, template_id=?, template_name=?, report_date=?,"
            " report_type=?, hospital=?, raw_text=? WHERE id=?",
            (patient_id, meta.get("template_id"), meta.get("template_name"),
             meta.get("report_date"), meta.get("report_type") or "", meta.get("hospital"),
             raw_text, report_id),
        )
        conn.execute("DELETE FROM results WHERE report_id=?", (report_id,))
        for i, it in enumerate(items):
            item = it.get("item", "") or ""
            conn.execute(
                "INSERT INTO results(report_id,item,item_norm,value_text,value_num,unit,ref_text,"
                "ref_low,ref_high,flag,seq,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, item, normalize_text(item), it.get("value_text", "") or "",
                 it.get("value_num"), it.get("unit") or "", it.get("ref_text") or "",
                 it.get("ref_low"), it.get("ref_high"), it.get("flag", "normal") or "normal",
                 i, _ts()),
            )


# ---------------------------------------------------------------------------
# 校对
# ---------------------------------------------------------------------------
def create_review(batch_id: Optional[int], task_id: Optional[int], filename: str,
                  template_id: Optional[str], template_name: Optional[str],
                  candidate: dict, raw_text: str, patient_id: Optional[int] = None) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO review_items(batch_id,task_id,patient_id,filename,template_id,template_name,"
            "patient_name,gender,birth_date,report_date,report_type,hospital,raw_text,parsed_json,"
            "confidence,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                batch_id, task_id, patient_id, filename, template_id, template_name,
                candidate.get("patient_name"), candidate.get("gender"),
                candidate.get("birth_date"), candidate.get("report_date"),
                candidate.get("report_type"), candidate.get("hospital"),
                raw_text, json.dumps(candidate, ensure_ascii=False, default=str),
                candidate.get("confidence"), "pending", _ts(), _ts(),
            ),
        )
        return cur.lastrowid


def get_review(review_id: int) -> Optional[dict]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM review_items WHERE id=?", (review_id,)).fetchone()
        if not r:
            return None
        out = dict(r)
        out["parsed"] = json.loads(out.pop("parsed_json") or "null")
        return out


def list_reviews(status: Optional[str] = None, offset: int = 0, limit: int = 50,
                 q: Optional[str] = None) -> dict:
    sql = "SELECT id,batch_id,filename,template_name,patient_name,gender,report_date,report_type," \
          "confidence,status,error,created_at,updated_at FROM review_items WHERE 1=1"
    params: list[Any] = []
    if status:
        sql += " AND status=?"
        params.append(status)
    if q:
        sql += " AND (filename LIKE ? OR patient_name LIKE ? OR report_type LIKE ?)"
        params += [f"%{q}%"] * 3
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM review_items WHERE 1=1"
                             + (" AND status=?" if status else ""), [status] if status else []).fetchone()["c"]
        rows = conn.execute(sql + " ORDER BY id DESC LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}


def update_review(review_id: int, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [_ts(), review_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE review_items SET {keys},updated_at=? WHERE id=?", vals)


def delete_reviews_of_task(task_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM review_items WHERE task_id=? AND status='pending'", (task_id,))


def review_count_by_status(status: str) -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) c FROM review_items WHERE status=?", (status,)).fetchone()["c"]


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------
def overview() -> dict:
    with get_conn() as conn:
        def one(sql, *p):
            return conn.execute(sql, p).fetchone()[0]

        pending = one("SELECT COUNT(*) FROM review_items WHERE status='pending'")
        return {
            "patients": one("SELECT COUNT(*) FROM patients"),
            "reports": one("SELECT COUNT(*) FROM reports"),
            "results": one("SELECT COUNT(*) FROM results"),
            "abnormal": one("SELECT COUNT(*) FROM results WHERE flag IN ('high','low')"),
            "pending_reviews": pending,
            "batches": one("SELECT COUNT(*) FROM batches"),
            "recent_batches": list_batches(8),
        }


def patient_items(patient_id: int) -> list[dict]:
    """某患者所有检验项目及概览（用于趋势选择器）。"""
    sql = (
        "SELECT r.item, r.item_norm, r.unit, MIN(rp.report_date) first_date, MAX(rp.report_date) last_date,"
        " COUNT(*) cnt, COUNT(CASE WHEN r.flag!='normal' THEN 1 END) abnormal_cnt "
        " FROM results r JOIN reports rp ON rp.id=r.report_id WHERE rp.patient_id=? "
        " GROUP BY r.item_norm ORDER BY last_date DESC, r.item"
    )
    with get_conn() as conn:
        return [dict(x) for x in conn.execute(sql, (patient_id,)).fetchall()]


def trend_series(patient_id: int, item_norm: str) -> list[dict]:
    sql = (
        "SELECT rp.id report_id, rp.report_date, rp.report_type, rp.hospital, rp.source_filename,"
        " r.item, r.value_text, r.value_num, r.unit, r.ref_text, r.ref_low, r.ref_high, r.flag "
        " FROM results r JOIN reports rp ON rp.id=r.report_id"
        " WHERE rp.patient_id=? AND r.item_norm=? AND rp.report_date IS NOT NULL"
        " ORDER BY rp.report_date, rp.id"
    )
    with get_conn() as conn:
        return [dict(x) for x in conn.execute(sql, (patient_id, item_norm)).fetchall()]


def abnormal_recent(limit: int = 10) -> list[dict]:
    sql = (
        "SELECT r.item,r.value_text,r.unit,r.flag,r.ref_text,r.value_num,p.name patient_name,"
        " rp.report_date FROM results r JOIN reports rp ON rp.id=r.report_id "
        " JOIN patients p ON p.id=rp.patient_id"
        " WHERE r.flag IN ('high','low') AND r.value_num IS NOT NULL"
        " ORDER BY rp.report_date DESC, rp.id DESC LIMIT ?"
    )
    with get_conn() as conn:
        return [dict(x) for x in conn.execute(sql, (limit,)).fetchall()]


def report_types() -> list[dict]:
    with get_conn() as conn:
        return [dict(x) for x in conn.execute(
            "SELECT report_type, COUNT(*) cnt FROM reports WHERE report_type!='' "
            "GROUP BY report_type ORDER BY cnt DESC").fetchall()]


def export_rows(patient_id: Optional[int] = None, item: Optional[str] = None,
                report_type: Optional[str] = None, date_from: Optional[str] = None,
                date_to: Optional[str] = None) -> list[dict]:
    sql = (
        "SELECT p.name patient_name,p.gender,p.birth_date,rp.report_date,rp.report_type,rp.hospital,"
        " rp.source_filename,r.item,r.value_text,r.value_num,r.unit,r.ref_text,r.ref_low,r.ref_high,r.flag "
        " FROM results r JOIN reports rp ON rp.id=r.report_id"
        " LEFT JOIN patients p ON p.id=rp.patient_id WHERE 1=1"
    )
    params: list[Any] = []
    if patient_id:
        sql += " AND rp.patient_id=?"
        params.append(patient_id)
    if report_type:
        sql += " AND rp.report_type=?"
        params.append(report_type)
    if item:
        sql += " AND r.item_norm LIKE ?"
        params.append(f"%{item}%")
    if date_from:
        sql += " AND rp.report_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND rp.report_date<=?"
        params.append(date_to)
    sql += " ORDER BY rp.report_date DESC, p.name"
    with get_conn() as conn:
        return [dict(x) for x in conn.execute(sql, params).fetchall()]
