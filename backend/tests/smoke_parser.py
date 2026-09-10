"""解析引擎冒烟测试：用合成坐标文本行验证"表格式检验单"解析全流程。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.pdf_service import Line  # noqa: E402
from app.services import parser as P  # noqa: E402


def _cell(x0: float, y0: float, x1: float, y1: float, text: str) -> Line:
    return Line(x0=x0, y0=y0, x1=x1, y1=y1, text=text)


def build_lab_page() -> list[Line]:
    lines = [
        # 头部：患者信息
        _cell(0, 0, 40, 14, "姓名：张三"),
        _cell(120, 0, 160, 14, "性别：男"),
        _cell(0, 18, 60, 32, "报告日期：2024-01-05"),
        # 表头
        _cell(0, 46, 90, 60, "检验项目"),
        _cell(160, 46, 210, 60, "结果"),
        _cell(280, 46, 320, 60, "单位"),
        _cell(400, 46, 500, 60, "参考范围"),
        _cell(560, 46, 600, 60, "提示"),
        # 数据行1：白细胞
        _cell(0, 72, 130, 88, "白细胞计数(WBC)"),
        _cell(160, 72, 200, 88, "6.5"),
        _cell(280, 72, 340, 88, "10^9/L"),
        _cell(400, 72, 470, 88, "3.5-9.5"),
        _cell(560, 72, 585, 88, ""),
        # 数据行2：血红蛋白（偏高）
        _cell(0, 100, 130, 116, "血红蛋白(HGB)"),
        _cell(160, 100, 200, 116, "178"),
        _cell(280, 100, 320, 116, "g/L"),
        _cell(400, 100, 470, 116, "115-150"),
        _cell(560, 100, 585, 116, "↑"),
        # 数据行3：尿酸（文本结果）
        _cell(0, 128, 130, 144, "尿蛋白定性"),
        _cell(160, 128, 210, 144, "阴性"),
        _cell(280, 128, 320, 144, ""),
        _cell(400, 128, 470, 144, "阴性"),
        _cell(560, 128, 585, 144, ""),
    ]
    return lines


def test_parse() -> None:
    pages = [build_lab_page()]
    result = P.parse_document(pages, None, None)
    assert result["patient_name"] == "张三", result
    assert result["gender"] == "男"
    assert result["report_date"] == "2024-01-05", result

    by_item = {it["item"]: it for it in result["items"]}
    assert "白细胞计数(WBC)" in by_item, by_item.keys()
    wbc = by_item["白细胞计数(WBC)"]
    assert wbc["value_num"] == 6.5 and wbc["value_text"] == "6.5"
    assert wbc["ref_low"] == 3.5 and wbc["ref_high"] == 9.5
    assert wbc["unit"] == "10^9/L"
    assert wbc["flag"] == "normal"

    hgb = by_item["血红蛋白(HGB)"]
    assert hgb["value_num"] == 178
    assert hgb["flag"] == "high", hgb

    ua = by_item["尿蛋白定性"]
    assert ua["value_text"] == "阴性" and ua["value_num"] is None

    print("PASS:", result["patient_name"], len(result["items"]), "项",
          [f"{i['item']}={i['value_text']}({i['flag']})" for i in result["items"]])


if __name__ == "__main__":
    test_parse()
