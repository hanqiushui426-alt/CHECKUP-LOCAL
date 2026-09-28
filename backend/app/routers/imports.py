"""导入相关 API：批次、任务队列、上传、重试、删除。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from ..services import models_dao as dao
from ..services import ingestion

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("")
async def upload_batch(files: list[UploadFile] = File(...)):
    """批量上传报告文件，创建导入批次并立即入队处理。"""
    if not files:
        raise HTTPException(400, "未选择任何文件")
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    batch_name = f"批量导入 {now}"
    batch_id = dao.create_batch(batch_name)
    tasks, rejected = [], []
    for f in files:
        content = await f.read()
        if not content:
            rejected.append({"filename": f.filename or "", "error": "空文件"})
            continue
        try:
            rel, kind = ingestion.save_upload(f.filename or "unnamed", content)
            ext = (f.filename or "").lower().rsplit(".", 1)[-1] if "." in (f.filename or "") else ""
            kind = "pdf" if ext == "pdf" else "image"
            task_id = dao.add_import_task(batch_id, f.filename or "unnamed", rel, kind)
            tasks.append(dao.get_task(task_id))
        except ValueError as e:
            rejected.append({"filename": f.filename or "", "error": str(e)})
    ingestion.start_workers()
    dao.refresh_batch(batch_id)
    dao.log_activity("import",
                     "log.importRejected" if rejected else "log.import",
                     {"batch": batch_name, "n": len(tasks), "r": len(rejected)})
    return {"batch": _get_batch(batch_id), "tasks": tasks, "rejected": rejected}


@router.get("/batches")
def list_batches(limit: int = 50):
    return dao.list_batches(limit)


@router.get("/batches/{batch_id}")
def batch_detail(batch_id: int):
    batch = _get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "批次不存在")
    return {"batch": batch, "tasks": dao.list_tasks(batch_id=batch_id)}


def _get_batch(batch_id: int):
    for b in dao.list_batches(9999):
        if b["id"] == batch_id:
            return b
    return None


@router.get("/tasks")
def list_tasks(batch_id: Optional[int] = Query(None), status: Optional[str] = Query(None),
               limit: int = Query(500, le=2000)):
    return dao.list_tasks(batch_id, status, limit)


@router.post("/tasks/{task_id}/retry")
def retry(task_id: int):
    task = dao.get_task(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    ingestion.retry_task(task_id)
    return dao.get_task(task_id)


@router.post("/retry-failed")
def retry_failed(batch_id: Optional[int] = None):
    """重试全部失败任务（可选按批次）。"""
    tasks = dao.list_tasks(batch_id=batch_id, status="error")
    for t in tasks:
        ingestion.retry_task(t["id"])
    return {"retried": len(tasks)}


@router.delete("/tasks/{task_id}")
def remove_task(task_id: int):
    if not dao.get_task(task_id):
        raise HTTPException(404, "任务不存在")
    dao.delete_task(task_id)
    return {"ok": True}


@router.delete("/batches/{batch_id}")
def remove_batch(batch_id: int):
    if not _get_batch(batch_id):
        raise HTTPException(404, "批次不存在")
    with dao.get_conn() as conn:
        conn.execute("DELETE FROM batches WHERE id=?", (batch_id,))
    return {"ok": True}
