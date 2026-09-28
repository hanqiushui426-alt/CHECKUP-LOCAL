"""模板加载、校验与自动匹配。

模板存放于两个目录：
  - backend/app/templates/           内置示例模板（只读）
  - backend/data/templates/          用户在界面上创建/编辑的自定义模板
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

from ..config import BUILTIN_TEMPLATES_DIR, CUSTOM_TEMPLATES_DIR

logger = logging.getLogger(__name__)


def normalize_text(text: str) -> str:
    """全角转半角、统一空白，用于关键词匹配。"""
    if not text:
        return ""
    out = []
    for ch in text:
        code = ord(ch)
        if code == 0x3000:
            out.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        else:
            out.append(ch)
    s = "".join(out)
    return re.sub(r"\s+", "", s)


class TemplateStore:
    def __init__(self) -> None:
        self._cache: Optional[dict[str, dict]] = None

    def _dirs(self):
        CUSTOM_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
        return [BUILTIN_TEMPLATES_DIR, CUSTOM_TEMPLATES_DIR]

    def load_all(self) -> dict[str, dict]:
        if self._cache is not None:
            return self._cache
        templates: dict[str, dict] = {}
        for d in self._dirs():
            if not d.exists():
                continue
            for fp in sorted(d.glob("*.json")):
                try:
                    tpl = json.loads(fp.read_text(encoding="utf-8"))
                    if isinstance(tpl, dict) and tpl.get("id"):
                        templates[tpl["id"]] = tpl
                except Exception as e:
                    logger.warning("加载模板失败 %s: %s", fp, e)
        self._cache = templates
        return templates

    def invalidate(self) -> None:
        self._cache = None

    def get(self, template_id: str) -> Optional[dict]:
        return self.load_all().get(template_id)

    def list_meta(self) -> list[dict]:
        result = []
        for tid, tpl in self.load_all().items():
            result.append(
                {
                    "id": tid,
                    "name": tpl.get("name", tid),
                    "category": tpl.get("category", "table"),
                    "builtin": tpl.get("id", "").startswith("builtin_")
                    or not _custom_exist(tid),
                    "item_mode": (tpl.get("items") or {}).get("mode", "table"),
                }
            )
        return result

    def add_or_update(self, tpl: dict) -> str:
        """保存/更新自定义模板（JSON 落在 data/templates）。"""
        tid = tpl.get("id") or _gen_id()
        tpl["id"] = tid
        CUSTOM_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
        (CUSTOM_TEMPLATES_DIR / f"{tid}.json").write_text(
            json.dumps(tpl, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self.invalidate()
        return tid

    def delete(self, tid: str) -> bool:
        fp = CUSTOM_TEMPLATES_DIR / f"{tid}.json"
        if fp.exists():
            fp.unlink()
            self.invalidate()
            return True
        return False

    def find_matches(self, raw_text: str) -> list[dict]:
        """按 match 规则返回命中的模板（特异性从高到低）。"""
        norm = normalize_text(raw_text)
        scored = []
        for tpl in self.load_all().values():
            m = tpl.get("match") or {}
            tokens = m.get("text_contains") or []
            excludes = m.get("exclude") or []
            hit = sum(1 for t in tokens if t and t in norm)
            blocked = any(t and t in norm for t in excludes)
            if not tokens:  # 兜底模板：未声明匹配词时按低特异性参与
                if excludes and blocked:
                    continue
                scored.append((0, len(tpl.get("name", "")), tpl))
                continue
            if blocked:
                continue
            if m.get("match_any"):  # 命中任意一个关键词即可（用于同一类版式的多个名称）
                if hit >= 1:
                    scored.append((10 + hit, -len(norm), tpl))
                continue
            if hit == len(tokens):
                scored.append((len(tokens) * 10 + len(tokens), -len(norm), tpl))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [t for _, _, t in scored]

    def best_match(self, raw_text: str) -> Optional[dict]:
        found = self.find_matches(raw_text)
        return found[0] if found else None


def _gen_id() -> str:
    import uuid

    return "custom_" + uuid.uuid4().hex[:10]


def _custom_exist(tid: str) -> bool:
    return (CUSTOM_TEMPLATES_DIR / f"{tid}.json").exists()


default_store = TemplateStore()
