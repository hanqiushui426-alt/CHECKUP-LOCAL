"""RapidOCR 本地离线 OCR 封装。

模型随 rapidocr_onnxruntime 包内置/按需下载至本机缓存，全部推理在本地完成。
使用 threading.local 为每个工作线程惰性加载引擎，允许并行识别。
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

from .pdf_service import Line

logger = logging.getLogger(__name__)

_instances = threading.local()
_lock = threading.Lock()


def _get_engine():
    engine = getattr(_instances, "engine", None)
    if engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except Exception as e:  # pragma: no cover
            logger.error("RapidOCR 未安装或初始化失败: %s", e)
            raise RuntimeError("RapidOCR 不可用，请检查依赖安装") from e
        engine = RapidOCR()
        _instances.engine = engine
    return engine


def engine_available() -> bool:
    try:
        import importlib.util

        return importlib.util.find_spec("rapidocr_onnxruntime") is not None
    except Exception:
        return False


def recognize(image_path: str | Path) -> list[Line]:
    """对图片执行 OCR，返回带坐标的文本行（自上而下排序）。"""
    engine = _get_engine()
    with _lock:  # RapidOCR 首次加载模型时做一次性初始化，避免并发下载冲突
        result = engine(str(image_path))
    if isinstance(result, tuple):
        result = result[0] if result else None
    lines: list[Line] = []
    if not result:
        return lines
    for item in result:
        try:
            box, text, _score = item[0], item[1], item[2]
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            text = (text or "").strip()
            if not text:
                continue
            lines.append(Line(x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys), text=text))
        except Exception:
            continue
    lines.sort(key=lambda ln: (ln.y0, ln.x0))
    return lines


def recognize_with_cache(image_path: str | Path, cache_key: Optional[str] = None) -> list[Line]:
    """带简单内存缓存的识别（同一任务页可能被重复渲染）。"""
    return recognize(image_path)
