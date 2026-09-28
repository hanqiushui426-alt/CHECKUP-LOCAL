"""FastAPI 应用入口：注册路由、静态托管前端、启动导入后台线程。

仅监听 127.0.0.1，全部数据与推理均在本机完成。
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import (FRONTEND_DIST, HOST, PAGE_IMG_DIR, PORT, UPLOAD_DIR, ensure_dirs)
from .db import init_db
from .routers import export, imports, patients, reports, review, stats, templates
from .services import ingestion

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---- 初始化本地数据目录/数据库/后台 OCR 线程 ----
ensure_dirs()
init_db()
ingestion.start_workers()

app = FastAPI(title="检查数据统计工作台", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

for r in (imports.router, review.router, patients.router, reports.router,
          stats.router, templates.router, export.router):
    app.include_router(r)


@app.middleware("http")
async def _disable_cache(request, call_next):
    """前端资源与接口一律不缓存，保证更新后立即生效。"""
    response = await call_next(request)
    if not request.url.path.startswith("/media/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/health")
def health():
    return {"ok": True}


# 本地文件服务（原始上传 + OCR/预览页图）
app.mount("/media/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/media/page_images", StaticFiles(directory=str(PAGE_IMG_DIR)), name="page_images")

_assets_dir = FRONTEND_DIST / "assets"
if _assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        # 禁止缓存入口页，保证前端更新后浏览器立即加载新版本
        return FileResponse(str(index), headers={"Cache-Control": "no-cache"})
    return JSONResponse({
        "message": "检查数据统计工作台后端已就绪",
        "tip": "前端尚未构建：请先构建前端或直接访问 /api/docs 查看接口文档",
    })


if __name__ == "__main__":
    import uvicorn

    logger.info("启动本地服务 http://%s:%s", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
