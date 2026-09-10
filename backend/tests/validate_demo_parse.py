"""pdf skill 验收：对 examples_reports/demo_blood_report.pdf 复现完整抽取→模板匹配→解析链路。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import pdf_service
from app.services import ingestion
from app.services.parser import parse_document
from app.services.template_store import default_store

SAMPLE = Path(__file__).resolve().parents[2] / "examples_reports" / "demo_blood_report.pdf"


def main() -> None:
    assert SAMPLE.exists(), SAMPLE
    task = {"id": -1, "kind": "pdf", "stored_path": SAMPLE, "md5": pdf_service.file_md5(SAMPLE)}

    # 1) 电子/扫描判别
    scanned, first = pdf_service.is_scanned_pdf(SAMPLE)
    print("is_scanned=%s first_scanned_page=%s" % (scanned, first))
    assert scanned is False, "电子版样例不应判为扫描件"

    # 2) 页级 Line 抽取（复现 ingestion 管道）
    pages, _ = ingestion._extract_all_lines(task)  # noqa: SLF001
    print("pages=%d 第1页 cell 行数=%d" % (len(pages), len(pages[0])))
    sample_lines = [(round(ln.x0), round(ln.y0), ln.text) for ln in pages[0][:14]]
    print("前 14 个单元格(坐标,文本):")
    for x0, y0, text in sample_lines:
        print("   x=%4d y=%4d  %s" % (x0, y0, text))

    # 3) 模板自动匹配 + 解析
    raw_text = "\n".join(ln.text for page in pages for ln in page)
    tpl = default_store.best_match(raw_text)
    print("命中模板: %s" % (tpl["name"] if tpl else "(兜底)"))
    cand = parse_document(pages, tpl, raw_text)
    print("患者: %s | 性别: %s | 日期: %s | 类型: %s | 医院: %s | 置信度: %s" % (
        cand["patient_name"], cand["gender"], cand["report_date"],
        cand["report_type"], cand["hospital"], cand["confidence"]))
    for it in cand["items"]:
        flag = {"high": "偏高", "low": "偏低", "normal": ""}.get(it["flag"], "")
        print("   item=%-22s value=%-8s num=%-6s unit=%-8s ref=%-10s %s" % (
            it["item"], it["value_text"], it["value_num"], it["unit"], it["ref_text"], flag))
    print("提取项数=%d 告警=%s" % (len(cand["items"]), cand["warnings"]))

    # 验收断言：与库内已确认 demo 数据一致（5 项，含偏高标记、数值化、参考区间解析）
    assert cand["patient_name"] == "张三"
    assert cand["report_date"] == "2024-01-05"
    items = cand["items"]
    assert len(items) == 5, items
    by_item = {i["item"].split("(")[0]: i for i in items}
    assert by_item["血红蛋白"]["value_num"] == 178.0
    assert by_item["血红蛋白"]["flag"] == "high"
    assert by_item["血红蛋白"]["ref_high"] == 150.0 and by_item["血红蛋白"]["ref_low"] == 115.0
    assert by_item["白细胞计数"]["unit"] == "10^9/L"
    print("\nPDF/TEMPLATE CALIBRATION PASSED")


if __name__ == "__main__":
    main()
