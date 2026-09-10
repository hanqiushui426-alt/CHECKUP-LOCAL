"""生成一份带文本层的"模拟检验报告"PDF，用于端到端联调（数字文本，不走 OCR）。"""
from __future__ import annotations

import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "examples_reports" / "demo_blood_report.pdf"


def main() -> None:
    import pymupdf as fitz

    fontfile = "C:/Windows/Fonts/msyh.ttc"
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4 pt
    # 使用微软雅黑嵌入中文字体
    if Path(fontfile).exists():
        page.insert_font(fontname="hei", fontfile=fontfile)
        font = "hei"
    else:
        page.insert_font(fontname="china-s")
        font = "china-s"  # pymupdf 内置 CJK 兜底
    size = 11

    def put(x: float, y: float, text: str, s: float = size):
        page.insert_text((x, y), text, fontname=font, fontsize=s)

    put(180, 60, "示例第一医院检验报告单", 18)
    put(60, 105, "姓名：张三")
    put(300, 105, "性别：男")
    put(60, 128, "年龄：45岁")
    put(300, 128, "样本号：S2024001188")
    put(60, 151, "报告日期：2024-01-05")
    put(300, 151, "科别：检验科")

    header_y = 190
    cols = [
        (60, "检验项目"),
        (230, "结果"),
        (330, "单位"),
        (410, "参考范围"),
        (540, "提示"),
    ]
    for x, t in cols:
        put(x, header_y, t)
    # 表头下划线示意
    page.draw_line((50, header_y + 8), (560, header_y + 8))

    rows = [
        ("白细胞计数(WBC)", "6.5", "10^9/L", "3.5-9.5", ""),
        ("血红蛋白(HGB)", "178", "g/L", "115-150", "↑"),
        ("血小板计数(PLT)", "230", "10^9/L", "125-350", ""),
        ("葡萄糖(GLU)", "5.6", "mmol/L", "3.9-6.1", ""),
        ("总胆固醇(TC)", "5.9", "mmol/L", "2.8-5.2", "H"),
    ]
    y = header_y + 30
    for row in rows:
        for (x, _), v in zip(cols, row):
            put(x, y, v)
        y += 26

    out = OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    print("saved:", out)


if __name__ == "__main__":
    main()
