"""全局路径与运行配置。所有数据仅保存在本机，不依赖外部网络服务。

路径全部基于 __file__ 推导，因此整个文件夹可以整体拷贝或放在 U 盘中运行。
绿色免安装版会把前端页面放在项目根的 web/，并自带 runtime/python 解释器。
"""
from __future__ import annotations

import os
from pathlib import Path

# backend/app/config.py -> parents[0]=backend/app, [1]=backend, [2]=项目根
APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent


def _env_dir(name: str) -> Path | None:
    """读取环境变量指定的目录（为空时返回 None）。"""
    v = os.getenv(name, "").strip()
    return Path(v) if v else None


DATA_DIR = _env_dir("CHECKUP_DATA_DIR") or (BACKEND_DIR / "data")
UPLOAD_DIR = DATA_DIR / "uploads"
PAGE_IMG_DIR = DATA_DIR / "page_images"
CUSTOM_TEMPLATES_DIR = DATA_DIR / "templates"
BUILTIN_TEMPLATES_DIR = APP_DIR / "templates"

DB_PATH = DATA_DIR / "app.db"

# 前端静态资源目录：优先内嵌的 web/（绿色版），其次开发态的 frontend/dist。
# 两者都不存在时回退到 web/，启动时由 main.py 给出"前端未构建"提示。
FRONTEND_DIST = _env_dir("CHECKUP_WEB_DIR") or next(
    (p for p in (PROJECT_ROOT / "web", PROJECT_ROOT / "frontend" / "dist") if p.exists()),
    PROJECT_ROOT / "web",
)

HOST = os.getenv("CHECKUP_HOST", "127.0.0.1")
PORT = int(os.getenv("CHECKUP_PORT", "8321"))

# 允许上传的扩展名（小写）
ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_UPLOAD_MB = 100

# 页级"电子文本/扫描"判别阈值：单页有效文本字符低于该值判为扫描页
SCANNED_PAGE_MIN_CHARS = 20
# 扫描页渲染 DPI
OCR_RENDER_DPI = 250
# OCR 并发工作线程数
OCR_WORKERS = 2

# 识别质量达标时自动入库（无需逐份人工确认）；不达标的仍进入"待核对"列表
AUTO_ARCHIVE = True


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOAD_DIR, PAGE_IMG_DIR, CUSTOM_TEMPLATES_DIR):
        d.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    from datetime import datetime

    return datetime.now().isoformat(timespec="seconds")
