"""患者归集与冲突处理。

以"归一化姓名"作为归集主键（NFKC 统一、去空白与标点）。
当识别到的性别/出生日期与既有档案冲突时，不覆盖旧档案，而是建立同名新档案，
由用户在校对/患者库界面通过"合并"解决。
"""
from __future__ import annotations

import re
import unicodedata
import sqlite3
from typing import Optional


def norm_name(name: str) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", name)
    s = re.sub(r"[\s·•.．,，、\-—_()（）男女患者]", "", s)
    return s.upper()


def resolve_patient(conn: sqlite3.Connection, name: str, gender: Optional[str] = None,
                    birth_date: Optional[str] = None) -> tuple[int, bool]:
    """归集到既有患者或新建档案。返回 (patient_id, created)。

    归集策略：**姓名归一化后相同即视为同一人**，直接归入最早建立的档案。
    早期版本会在性别/出生日期识别不一致时新建同名档案，导致同一患者的批量报告
    被拆成多个档案（识别噪声导致的假冲突），因此这里不再因信息冲突拆分档案，
    仅补充档案缺失的性别/出生日期。真实重名由用户在患者库手工处理。
    """
    norm = norm_name(name)
    rows = conn.execute(
        "SELECT * FROM patients WHERE name_norm=? ORDER BY id", (norm,)
    ).fetchall()
    # 模糊兜底：OCR/字形差异（如"逄瑞芝"与"逢瑞芝"）会产生仅一字之差的姓名，
    # 若库中只有唯一一个高度相近的档案（长度差≤1 且相同字符≥60%），视为同一人。
    if not rows and len(norm) >= 2:
        fuzzy = [
            row for row in conn.execute("SELECT * FROM patients").fetchall()
            if row["name_norm"] and row["name_norm"] != norm
            and abs(len(row["name_norm"]) - len(norm)) <= 1
            and name_similarity(norm, row["name_norm"]) >= 0.6
        ]
        if len(fuzzy) == 1:
            rows = fuzzy

    if not rows:
        cur = conn.execute(
            "INSERT INTO patients(name,name_norm,gender,birth_date,created_at,updated_at) "
            "VALUES(?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))",
            (name, norm, gender, birth_date),
        )
        return cur.lastrowid, True

    p = rows[0]
    updates, params = [], []
    if gender and not p["gender"]:
        updates.append("gender=?")
        params.append(gender)
    if birth_date and not p["birth_date"]:
        updates.append("birth_date=?")
        params.append(birth_date)
    if updates:
        params.append(p["id"])
        conn.execute(
            f"UPDATE patients SET {','.join(updates)},updated_at=datetime('now','localtime') WHERE id=?",
            params,
        )
    return p["id"], False


_SIMILAR_CACHE: dict[tuple[str, str], float] = {}


def name_similarity(a: str, b: str) -> float:
    """粗略姓名相似度（用于提示"疑似同一人"）：相同字符占比。"""
    if not a or not b:
        return 0.0
    key = (a, b)
    if key in _SIMILAR_CACHE:
        return _SIMILAR_CACHE[key]
    sa, sb = set(a), set(b)
    score = len(sa & sb) / max(1, min(len(sa), len(sb)))
    _SIMILAR_CACHE[key] = score
    return score


def find_similar_patients(conn: sqlite3.Connection, name: str,
                          threshold: float = 0.5) -> list[sqlite3.Row]:
    """查找归一化姓名相近但不等同的档案，用于提示可能的重复建档。"""
    norm = norm_name(name)
    if len(norm) < 2:
        return []
    out = []
    for row in conn.execute("SELECT * FROM patients").fetchall():
        other = row["name_norm"] or ""
        if not other or other == norm or abs(len(other) - len(norm)) > 1:
            continue
        if name_similarity(norm, other) >= threshold:
            out.append(row)
    return out


def find_patients_by_name(conn: sqlite3.Connection, name: str) -> list[sqlite3.Row]:
    norm = norm_name(name)
    return conn.execute(
        "SELECT * FROM patients WHERE name_norm=? ORDER BY id", (norm,)
    ).fetchall()
