"""openpyxl 导出 .xlsx：检验结果明细、单患者单指标趋势序列。"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from . import models_dao as dao
from .i18n import tr

HEADER_FILL = PatternFill("solid", fgColor="0F766E")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11, name="微软雅黑")
DATA_FONT = Font(name="微软雅黑", size=10)

FLAG_TEXT = {"high": {"zh-CN": "偏高", "en-US": "High"},
             "low": {"zh-CN": "偏低", "en-US": "Low"},
             "normal": {"zh-CN": "", "en-US": ""}}


def _flag_text(flag: str, lang: str) -> str:
    return FLAG_TEXT.get(flag, FLAG_TEXT["normal"]).get(lang, FLAG_TEXT[flag]["zh-CN"])
ABNORMAL_HIGH_FILL = PatternFill("solid", fgColor="FEF2F2")
ABNORMAL_LOW_FILL = PatternFill("solid", fgColor="E0F2F1")
THIN = Side(style="thin", color="CBD5E1")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def _sheet_widths(ws, headers: list[str]) -> None:
    for idx, h in enumerate(headers, start=1):
        w = len(h) * 2
        for row in ws.iter_rows(min_row=2, min_col=idx, max_col=idx):
            v = row[0].value
            if v is not None:
                s = str(v)
                w = max(w, sum(2 if ord(c) > 127 else 1 for c in s))
        ws.column_dimensions[get_column_letter(idx)].width = min(max(10, w + 2), 42)


def _write_header(ws, headers: list[str]) -> None:
    ws.append(headers)
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
    ws.freeze_panes = "A2"


def _style_body(ws) -> None:
    for row in ws.iter_rows(min_row=2, max_col=ws.max_column):
        for c in row:
            c.font = DATA_FONT
            c.border = BORDER
            c.alignment = Alignment(vertical="center", wrap_text=False)


def export_results_xlsx(patient_id: Optional[int] = None, item: Optional[str] = None,
                        report_type: Optional[str] = None, date_from: Optional[str] = None,
                        date_to: Optional[str] = None, lang: Optional[str] = None) -> bytes:
    rows = dao.export_rows(patient_id, item, report_type, date_from, date_to)
    lng = lang or "zh-CN"
    wb = Workbook()
    ws = wb.active
    ws.title = tr(lng, "sheet.results")
    headers = [tr(lng, "col.patient"), tr(lng, "col.gender"), tr(lng, "col.reportDate"),
               tr(lng, "col.testItem"), tr(lng, "col.hospital"), tr(lng, "col.item"),
               tr(lng, "col.value"), tr(lng, "col.valueNum"), tr(lng, "col.unit"),
               tr(lng, "col.ref"), tr(lng, "col.refLow"), tr(lng, "col.refHigh"),
               tr(lng, "col.flag"), tr(lng, "col.source")]
    _write_header(ws, headers)
    for r in rows:
        flag = _flag_text(r["flag"], lng)
        ws.append([
            r["patient_name"] or "", r["gender"] or "", r["report_date"] or "",
            r["report_type"] or "", r["hospital"] or "", r["item"] or "",
            r["value_text"] or "", r["value_num"] if r["value_num"] is not None else "",
            r["unit"] or "", r["ref_text"] or "",
            r["ref_low"] if r["ref_low"] is not None else "",
            r["ref_high"] if r["ref_high"] is not None else "",
            flag, r["source_filename"] or "",
        ])
        if r["flag"] == "high":
            fill = ABNORMAL_HIGH_FILL
        elif r["flag"] == "low":
            fill = ABNORMAL_LOW_FILL
        else:
            continue
        for cell in ws[ws.max_row]:
            cell.fill = fill
    _sheet_widths(ws, headers)
    _style_body(ws)
    return _to_bytes(wb)


def export_trend_xlsx(patient_id: int, item_norm: str, lang: Optional[str] = None) -> bytes:
    series = dao.trend_series(patient_id, item_norm)
    lng = lang or "zh-CN"
    wb = Workbook()
    ws = wb.active
    ws.title = tr(lng, "sheet.trend")
    headers = [tr(lng, "col.reportDate"), tr(lng, "col.testItem"), tr(lng, "col.value"),
               tr(lng, "col.valueNum"), tr(lng, "col.unit"), tr(lng, "col.refLow"),
               tr(lng, "col.refHigh"), tr(lng, "col.flag"), tr(lng, "col.source")]
    _write_header(ws, headers)
    for r in series:
        ws.append([
            r["report_date"], r["report_type"] or "", r["value_text"],
            r["value_num"] if r["value_num"] is not None else "",
            r["unit"] or "", r["ref_low"] if r["ref_low"] is not None else "",
            r["ref_high"] if r["ref_high"] is not None else "",
            _flag_text(r["flag"], lng),
            r["source_filename"] or "",
        ])
    _sheet_widths(ws, headers)
    _style_body(ws)
    return _to_bytes(wb)


def _to_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
