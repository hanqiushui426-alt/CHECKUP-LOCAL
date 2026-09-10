"""批量导入任务队列与后台处理。

生命周期：
  queued -> extracting/ocr -> parsing -> review(pending 校对) / error
后台 N 个工作线程持续认领 queued 任务；同一文件 OCR 页级结果以 JSON 缓存于
data/ocr_cache/<md5>.json，供"换模板重解析"复用，避免重复 OCR。
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from pathlib import Path

from ..config import (ALLOWED_EXTS, AUTO_ARCHIVE, DATA_DIR, OCR_RENDER_DPI,
                      OCR_WORKERS, ensure_dirs, now_iso)
from . import models_dao as dao
from . import pdf_service
from . import parser as parser_mod
from . import ocr_service
from .archive import archive
from .template_store import default_store

logger = logging.getLogger(__name__)

CACHE_DIR = DATA_DIR / "ocr_cache"
_worker_threads: list[threading.Thread] = []
_start_lock = threading.Lock()


class DuplicateFileError(Exception):
    pass


# ---------------------------------------------------------------------------
# 上传与文件落盘
# ---------------------------------------------------------------------------
def save_upload(filename: str, content: bytes) -> tuple[str, str]:
    """保存上传文件到 uploads 目录，返回 (相对路径, 扩展名)。"""
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise ValueError(f"不支持的文件类型：{ext or '(无扩展名)'}（仅支持 pdf/png/jpg/jpeg/webp/bmp）")
    if len(content) > 100 * 1024 * 1024:
        raise ValueError("单个文件超过 100MB 限制")
    ensure_dirs()
    (DATA_DIR / "uploads").mkdir(exist_ok=True)
    rel = f"uploads/{uuid.uuid4().hex}{ext}"
    (DATA_DIR / rel).write_bytes(content)
    return rel, ext.lstrip(".")


def rel_abs(rel: str) -> Path:
    return DATA_DIR / rel


# ---------------------------------------------------------------------------
# 页级行缓存
# ---------------------------------------------------------------------------
def cache_store(md5: str, pages: list[list[dict]]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{md5}.json").write_text(
        json.dumps(pages, ensure_ascii=False), encoding="utf-8"
    )


def cache_load(md5: str) -> list[list[dict]] | None:
    fp = CACHE_DIR / f"{md5}.json"
    if not fp.exists():
        return None
    try:
        return json.loads(fp.read_text(encoding="utf-8"))
    except Exception:
        return None


def lines_from_cache(md5: str) -> list[list] | None:
    pages = cache_load(md5)
    if pages is None:
        return None
    return [[pdf_service.Line(**d) for d in page] for page in pages]


# ---------------------------------------------------------------------------
# 单任务处理
# ---------------------------------------------------------------------------
def _mark(task_id: int, status: str, error: str = "") -> None:
    dao.update_task(task_id, status=status, error=error or None)


def _mixed_page_lines(path, page, page_index: int, md5: str) -> list:
    """单页抽取：电子文本层为主；文本过于稀疏（主体可能是图片）时 OCR 兜底，取更丰富者。

    典型场景：检验报告 PDF 主体是位图、仅页脚带少量文字层，容易被误判为电子页。
    """
    digital = pdf_service.extract_pdf_page_lines(page)
    digital_chars = pdf_service.page_chars_count(digital)
    if digital_chars >= 150 and len(digital) >= 12:
        return digital
    try:
        png = pdf_service.render_pdf_page_png_deterministic(path, page_index, md5)
        ocr_lines = ocr_service.recognize(png)
    except Exception:
        logger.exception("OCR 兜底失败 page=%s", page_index)
        return digital
    return ocr_lines if pdf_service.page_chars_count(ocr_lines) > digital_chars else digital


def _extract_all_lines(task: dict) -> tuple[list[list], int]:
    """抽取整份文档的逐页文本行。返回 (pages, pages_total)。"""
    path = rel_abs(task["stored_path"])
    kind = task["kind"]
    md5 = task["md5"] or ""
    pages: list[list] = []

    if kind == "pdf":
        import pymupdf as fitz

        with fitz.open(str(path)) as doc:
            total = doc.page_count
            for i in range(total):
                pages.append(_mixed_page_lines(path, doc[i], i, md5))
                dao.update_task(task["id"], pages_done=i + 1, current_page=i + 1)
        return pages, total

    # 图片：本身即一页
    lines = ocr_service.recognize(path)
    pages.append(lines)
    return pages, 1


def extract_pages(path, kind: str, md5: str) -> list[list]:
    """按文件抽取逐页文本行（优先复用缓存），供重解析等场景使用。

    若缓存内容过于稀疏（如旧版本只抓到页脚文字层），视为无效缓存重新抽取。
    """
    cached = lines_from_cache(md5)
    if cached is not None:
        total_chars = sum(pdf_service.page_chars_count(p) for p in cached)
        n_pages = max(1, len(cached))
        if total_chars >= 150 * n_pages:
            return cached
        logger.info("OCR 缓存内容稀疏（%s 字符 / %s 页），重新抽取", total_chars, n_pages)
    pages: list[list] = []
    if kind == "pdf" and pdf_service.is_pdf_file(path):
        import pymupdf as fitz

        with fitz.open(str(path)) as doc:
            for i in range(doc.page_count):
                pages.append(_mixed_page_lines(path, doc[i], i, md5))
    else:
        pages.append(ocr_service.recognize(path))
    cache_store(md5, [[ln.to_dict() for ln in pg] for pg in pages])
    return pages


def _ready_for_archive(candidate: dict, template: dict | None) -> bool:
    """是否达到自动入库标准：姓名与日期齐全，且抽到检验项（文字型模板除外）。"""
    if not (candidate.get("patient_name") or "").strip():
        return False
    if not candidate.get("report_date"):
        return False
    if candidate.get("items"):
        return True
    # 骨髓/影像等纯文字型报告本就没有数值项，允许直接入库
    return ((template or {}).get("items") or {}).get("mode") == "none"


def process_task(task_id: int) -> None:
    task = dao.get_task(task_id)
    if not task:
        return
    try:
        # 去重
        path = rel_abs(task["stored_path"])
        md5 = task["md5"] or pdf_service.file_md5(path)
        if not task["md5"]:
            dao.update_task(task_id, md5=md5)
        existing = dao.report_exists_by_md5(md5)
        if existing is not None:
            raise DuplicateFileError("重复文件（此前已导入），已跳过")

        pages = lines_from_cache(md5)
        if pages is None:
            _mark(task_id, "extracting")
            raw_pages, total = _extract_all_lines(task)
            pages = raw_pages
            dao.update_task(task_id, pages_total=total)
            cache_store(md5, [[ln.to_dict() for ln in pg] for pg in pages])

        _mark(task_id, "parsing")
        raw_text = "\n".join(ln.text for page in pages for ln in page)
        template = default_store.best_match(raw_text)
        candidate = parser_mod.parse_document(pages, template, raw_text,
                                              source_name=task["filename"])

        # 识别质量达标 -> 直接入库；否则进入"待核对"列表
        if AUTO_ARCHIVE and _ready_for_archive(candidate, template):
            try:
                report = archive(
                    candidate, filename=task["filename"],
                    stored_path=task["stored_path"], md5=md5,
                    task_id=task_id, batch_id=task["batch_id"], raw_text=raw_text,
                )
                dao.delete_reviews_of_task(task_id)
                dao.update_task(task_id, status="done", pages_total=len(pages),
                                pages_done=len(pages), current_page=len(pages), error=None)
                logger.info("任务 %s 自动入库 report_id=%s items=%s", task_id,
                            report["id"], len(candidate.get("items", [])))
                return
            except Exception:
                logger.exception("任务 %s 自动入库失败，转入待核对", task_id)

        dao.delete_reviews_of_task(task_id)
        review_id = dao.create_review(
            batch_id=task["batch_id"], task_id=task_id, filename=task["filename"],
            template_id=(template or {}).get("id") if template else None,
            template_name=(template or {}).get("name") if template else None,
            candidate=candidate, raw_text=raw_text,
        )
        dao.update_task(task_id, status="review", pages_total=len(pages),
                        pages_done=len(pages), current_page=len(pages), error=None)
        logger.info("任务 %s 解析完成 待核对 review_id=%s items=%s", task_id, review_id,
                    len(candidate.get("items", [])))
    except DuplicateFileError as e:
        _mark(task_id, "error", str(e))
        logger.info("去重跳过: %s", e)
    except Exception:
        logger.exception("任务 %s 处理失败", task_id)
        _mark(task_id, "error", "处理失败，请查看日志后重试")
    finally:
        dao.refresh_batch(task["batch_id"])


def retry_task(task_id: int) -> None:
    dao.update_task(task_id, status="queued", error=None, pages_done=0, current_page=0)
    t = dao.get_task(task_id)
    if t:
        dao.refresh_batch(t["batch_id"])


# ---------------------------------------------------------------------------
# 后台工作线程
# ---------------------------------------------------------------------------
def _worker_loop() -> None:
    logger.info("OCR 工作线程启动")
    while True:
        try:
            task = dao.claim_next_task()
            if task:
                process_task(task["id"])
                continue
        except Exception:
            logger.exception("worker 异常")
        time.sleep(0.8)


def start_workers() -> None:
    global _worker_threads
    with _start_lock:
        if _worker_threads and any(t.is_alive() for t in _worker_threads):
            return
        _worker_threads = []
        for _ in range(max(1, OCR_WORKERS)):
            t = threading.Thread(target=_worker_loop, name="ocr-worker", daemon=True)
            t.start()
            _worker_threads.append(t)
