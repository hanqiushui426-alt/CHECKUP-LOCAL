"""PDF/图片的文本抽取与页面渲染。

抽取策略以"单元(cell)"为单位输出文本行（带页面坐标）：
  - 电子版 PDF：基于 rawdict 的字符级 bbox，按水平字符间隙切分出表格单元格列位置，
    供"表格式"解析引擎与 OCR 输出对齐；
  - 扫描 PDF / 图片：渲染 PNG 后交给 RapidOCR（OCR 输出天然为逐单元格带坐标文本行）。

额外能力：md5（重复检测/缓存）、扫描页判定、页面缩略图渲染。
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, asdict
from pathlib import Path

from ..config import PAGE_IMG_DIR, SCANNED_PAGE_MIN_CHARS, OCR_RENDER_DPI

logger = logging.getLogger(__name__)

try:  # pymupdf>=1.24 推荐 import pymupdf；旧版为 fitz
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz  # type: ignore


@dataclass
class Line:
    """一行文本单元（带页面内坐标，x 轴从左向右）。"""

    x0: float
    y0: float
    x1: float
    y1: float
    text: str

    def to_dict(self):
        return asdict(self)


def file_md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_image_file(path: Path) -> bool:
    return path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def is_pdf_file(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def pdf_page_count(path: Path) -> int:
    with fitz.open(str(path)) as doc:
        return doc.page_count


def _segment_chars(chars: list[tuple[list[float], str]]) -> list[tuple[list[float], str]]:
    """把一行内的字符按水平间隙切成若干"单元格"，返回 (包围盒, 文本)。"""
    if not chars:
        return []
    chars = sorted(chars, key=lambda t: (t[0][1], t[0][0]))
    widths = sorted((b[2] - b[0]) for b, _ in chars)
    med = widths[len(widths) // 2] if widths else 1.0
    gap_thresh = max(1.5, med * 0.45)

    groups: list[list[tuple[list[float], str]]] = [[chars[0]]]
    for prev, nxt in zip(chars, chars[1:]):
        if nxt[0][0] - prev[0][2] > gap_thresh:
            groups.append([])
        groups[-1].append(nxt)

    out: list[tuple[list[float], str]] = []
    for g in groups:
        text = "".join(c for _, c in g)
        if not text.strip():
            continue
        x0 = min(c[0][0] for c in g)
        y0 = min(c[0][1] for c in g)
        x1 = max(c[0][2] for c in g)
        y1 = max(c[0][3] for c in g)
        out.append(([x0, y0, x1, y1], text))
    return out


def extract_pdf_page_lines(page) -> list[Line]:
    """从电子版 PDF 页还原"单元格"文本行（带坐标，自上而下、行内从左到右）。"""
    cells: list[Line] = []
    try:
        raw = page.get_text("rawdict")
        blocks = raw.get("blocks", [])
    except Exception:
        blocks = []
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            chars: list[tuple[list[float], str]] = []
            for span in line.get("spans", []):
                for ch in span.get("chars", []):
                    bbox = ch.get("bbox")
                    c = ch.get("c", "")
                    if bbox and c.strip():
                        chars.append((list(bbox), c))
            for bbox, text in _segment_chars(chars):
                cells.append(Line(x0=bbox[0], y0=bbox[1], x1=bbox[2], y1=bbox[3], text=text))

    if not cells:
        # 回退：get_text('words')，以空格分词作为单元格（保持坐标）
        try:
            for w in page.get_text("words"):
                x0, y0, x1, y1, word = w[0], w[1], w[2], w[3], w[4]
                word = word.strip()
                if word:
                    cells.append(Line(x0=x0, y0=y0, x1=x1, y1=y1, text=word))
        except Exception:
            logger.exception("PDF 单词回退抽取失败")
    cells.sort(key=lambda ln: (ln.y0, ln.x0))
    return cells


def page_chars_count(lines: list[Line]) -> int:
    return sum(len(ln.text.strip()) for ln in lines)


def render_pdf_page_png_deterministic(pdf_path: Path, page_index: int, md5: str) -> Path:
    """确定性文件名渲染页面（校对缩略图与 OCR 缓存用）。"""
    PAGE_IMG_DIR.mkdir(parents=True, exist_ok=True)
    out = PAGE_IMG_DIR / f"{md5}_p{page_index}.png"
    if out.exists():
        return out
    with fitz.open(str(pdf_path)) as doc:
        pix = doc[page_index].get_pixmap(dpi=OCR_RENDER_DPI, colorspace=fitz.csRGB, alpha=False)
        pix.save(str(out))
    return out


def is_scanned_pdf(path: Path) -> tuple[bool, int | None]:
    """判断 PDF 是否偏扫描件。返回 (是否扫描件, 首个扫描页索引)。"""
    try:
        with fitz.open(str(path)) as doc:
            total_chars = 0
            scanned_first: int | None = None
            for i in range(doc.page_count):
                lines = extract_pdf_page_lines(doc[i])
                c = page_chars_count(lines)
                total_chars += c
                if c < SCANNED_PAGE_MIN_CHARS and scanned_first is None:
                    scanned_first = i
            is_scanned = doc.page_count == 0 or total_chars < doc.page_count * SCANNED_PAGE_MIN_CHARS
            return is_scanned, scanned_first
    except Exception:
        logger.exception("is_scanned_pdf 失败: %s", path)
        return True, None
