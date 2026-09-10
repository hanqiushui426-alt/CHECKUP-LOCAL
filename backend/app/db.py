"""SQLite 连接管理与建表迁移。

每次访问通过 get_conn() 打开独立短连接，天然线程安全（后台 OCR/导入线程也可使用）。
schema 版本由 PRAGMA user_version 管理。
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .config import DATA_DIR, DB_PATH, ensure_dirs

SCHEMA_VERSION = 2

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    total_files INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'running',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id    INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'pdf',   -- pdf | image
    status      TEXT NOT NULL DEFAULT 'queued',-- queued|extracting|ocr|parsing|review|done|error
    error       TEXT,
    pages_total INTEGER NOT NULL DEFAULT 0,
    pages_done  INTEGER NOT NULL DEFAULT 0,
    current_page INTEGER NOT NULL DEFAULT 0,
    md5         TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON import_tasks(batch_id);

CREATE TABLE IF NOT EXISTS patients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    name_norm  TEXT NOT NULL,
    gender     TEXT,
    birth_date TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name_norm);

CREATE TABLE IF NOT EXISTS reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    batch_id       INTEGER REFERENCES batches(id) ON DELETE SET NULL,
    task_id        INTEGER REFERENCES import_tasks(id) ON DELETE SET NULL,
    source_filename TEXT NOT NULL,
    stored_path    TEXT NOT NULL,
    template_id    TEXT,
    template_name  TEXT,
    report_date    TEXT,
    report_type    TEXT,
    hospital       TEXT,
    raw_text       TEXT,
    page_image     TEXT,
    md5            TEXT,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_patient ON reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date);

CREATE TABLE IF NOT EXISTS results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    item       TEXT NOT NULL,
    item_norm  TEXT NOT NULL,
    value_text TEXT NOT NULL,
    value_num  REAL,
    unit       TEXT,
    ref_text   TEXT,
    ref_low    REAL,
    ref_high   REAL,
    flag       TEXT NOT NULL DEFAULT 'normal',  -- high | low | normal
    seq        INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_report ON results(report_id);
CREATE INDEX IF NOT EXISTS idx_results_item ON results(item_norm);

CREATE TABLE IF NOT EXISTS review_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id       INTEGER REFERENCES batches(id) ON DELETE SET NULL,
    task_id        INTEGER REFERENCES import_tasks(id) ON DELETE SET NULL,
    patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    filename       TEXT NOT NULL,
    template_id    TEXT,
    template_name  TEXT,
    patient_name   TEXT,
    gender         TEXT,
    birth_date     TEXT,
    report_date    TEXT,
    report_type    TEXT,
    hospital       TEXT,
    raw_text       TEXT,
    page_image     TEXT,
    parsed_json    TEXT,
    confidence     REAL,
    status         TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|skipped|error
    error          TEXT,
    report_id      INTEGER,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_items(status);

CREATE TABLE IF NOT EXISTS activity_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL,
    kind   TEXT NOT NULL,   -- import | archive | edit | delete | merge | patient | reparse
    detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
"""


def _connect() -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """初始化数据目录与 schema。"""
    ensure_dirs()
    with get_conn() as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version < SCHEMA_VERSION:
            conn.executescript(_SCHEMA_SQL)
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
