"""解析模板管理 API：列表/详情/新增/编辑/删除 + 基于样例文件或校对记录的实时解析预览。"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile

from ..services import models_dao as dao
from ..services import parser as parser_mod
from ..services import pdf_service
from ..services.ingestion import cache_store, rel_abs, save_upload
from ..services.template_store import TemplateStore, default_store
from ..config import DATA_DIR

router = APIRouter(prefix="/api/templates", tags=["templates"])

_BUILTIN_PREFIX = "builtin_"


def _store() -> TemplateStore:
    return default_store


@router.get("")
def list_templates():
    return _store().list_meta()


@router.get("/{template_id}")
def template_detail(template_id: str):
    tpl = _store().get(template_id)
    if not tpl:
        raise HTTPException(404, "模板不存在")
    return tpl


@router.post("")
def create_template(payload: dict):
    tpl = _sanitize(payload)
    if not tpl.get("name"):
        raise HTTPException(400, "请填写模板名称")
    tpl.pop("id", None)  # 新建一律自动生成 id
    tid = _store().add_or_update(tpl)
    return _store().get(tid)


@router.put("/{template_id}")
def update_template(template_id: str, payload: dict):
    existing = _store().get(template_id)
    if not existing:
        raise HTTPException(404, "模板不存在")
    if template_id.startswith(_BUILTIN_PREFIX):
        # 内置模板不可原地修改；保存为自定义副本
        tpl = _sanitize(payload)
        tpl["name"] = (tpl.get("name") or existing.get("name") or "") + "（副本）"
        tpl.pop("id", None)
        tid = _store().add_or_update(tpl)
        return _store().get(tid)
    tpl = _sanitize(payload)
    tpl["id"] = template_id
    tid = _store().add_or_update(tpl)
    return _store().get(tid)


@router.delete("/{template_id}")
def remove_template(template_id: str):
    if template_id.startswith(_BUILTIN_PREFIX):
        raise HTTPException(400, "内置模板不可删除")
    if not _store().delete(template_id):
        raise HTTPException(404, "模板不存在")
    return {"ok": True}


def _sanitize(payload: dict) -> dict:
    allowed = {"name", "category", "match", "patient", "items", "report_type"}
    out = {k: v for k, v in payload.items() if k in allowed}
    # 只保留可 JSON 序列化内容
    try:
        json.dumps(out, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"配置内容不合法: {e}") from e
    return out


# ---------------------------------------------------------------------------
# 实时解析预览
# ---------------------------------------------------------------------------
@router.post("/debug")
def debug_template(review_id: int, template_id: Optional[str] = Query(None)):
    """对已导入的一则校对记录，用指定模板实时重解析预览。"""
    item = dao.get_review(review_id)
    if not item:
        raise HTTPException(404, "校对记录不存在")
    task = dao.get_task(item["task_id"]) if item["task_id"] else None
    if not task:
        raise HTTPException(400, "源文件缺失")
    pages = _pages_of_task(task)
    template = default_store.get(template_id) if template_id else None
    raw_text = "\n".join(ln.text for page in pages for ln in page)
    return parser_mod.parse_document(pages, template, raw_text)


@router.post("/debug-file")
async def debug_file(file: UploadFile = File(...), template_id: Optional[str] = Query(None)):
    """上传样例文件（PDF/图片）直接做解析预览，不落库。"""
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    try:
        rel, kind = save_upload(file.filename or "sample", content)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    path = rel_abs(rel)
    md5 = pdf_service.file_md5(path)
    task = {"id": -1, "stored_path": rel, "kind": kind, "md5": md5}
    pages = _pages_of_task(task)
    template = default_store.get(template_id) if template_id else None
    raw_text = "\n".join(ln.text for page in pages for ln in page)
    try:
        return parser_mod.parse_document(pages, template, raw_text)
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass


def _pages_of_task(task: dict):
    from ..services.ingestion import cache_load
    from ..services.pdf_service import Line

    md5 = task.get("md5")
    pages = cache_load(md5) if md5 else None
    if pages is not None:
        return [[Line(**d) for d in pg] for pg in pages]
    from ..services import ingestion

    pages_raw, _ = ingestion._extract_all_lines(task)  # noqa: SLF001
    if md5:
        cache_store(md5, [[ln.to_dict() for ln in pg] for pg in pages_raw])
    return pages_raw
