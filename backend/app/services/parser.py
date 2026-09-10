"""模板驱动的解析引擎。

解析输入为"逐页单元格文本行"（来自电子 PDF 文本层或 OCR），
结合模板配置中的：
  - patient 正则（姓名/性别/出生日期/报告日期）；
  - items.mode=table 的表头列锚点对齐算法；
  - 数值 / 参考区间 / 高低标记 的通用解析规则。

产物 candidate 结构（与校对表单、DB 一一对应）：
{
  "patient_name","gender","birth_date","report_date","report_type","hospital",
  "template_id","template_name","mode",
  "items": [{item,value_text,value_num,unit,ref_text,ref_low,ref_high,flag}],
  "confidence": float, "warnings": [...]
}
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

from .pdf_service import Line
from .template_store import normalize_text

_NUM = r"-?\d+(?:\.\d+)?"
_REF_RANGE = re.compile(rf"^\s*(?:\(|（)?\s*({_NUM})\s*[-~—–至]\s*({_NUM})\s*(?:\)|）)?\s*$")
_REF_SINGLE_LOW = re.compile(rf"^\s*[<>≤≥]?\s*({_NUM})\s*$")
_VALUE_WITH_MARK = re.compile(rf"^\s*([<>≤≥↑↓]?)\s*({_NUM})\s*([↑↓HL]?)\s*$")
_ARROWS = {"↑": "high", "↓": "low", "H": "high", "L": "low", "偏高": "high", "偏低": "low", "高": "high", "低": "low"}


def to_float_num(text: str) -> Optional[float]:
    try:
        return float(text)
    except Exception:
        return None


def _clean_num(num_text: str) -> float:
    return float(num_text)


# ---------------------------------------------------------------------------
# 通用正则（患者信息在整页文本上搜索）
# ---------------------------------------------------------------------------
_RE_NAME = re.compile(
    r"(?:患者)?(?:姓名)\s*[:：]\s*([\u4e00-\u9fa5A-Za-z·•]{2,12})|"
    r"(?:患者)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z·•]{2,12})(?=[,，\s]*(?:性别|男|女))"
)
_RE_GENDER = re.compile(r"性别\s*[:：]?\s*([男女])")
_RE_BIRTH = re.compile(r"(?:出生日期|出生年月|出生时间|生日|DOB)\s*[:：]?\s*((?:19|20)\d{2})[年./\-](\d{1,2})[月./\-](\d{1,2})日?")
_RE_DATE = re.compile(r"((?:19|20)\d{2})\s*[年./\-]\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})\s*日?")
_RE_HOSPITAL = re.compile(r"([\u4e00-\u9fa5A-Za-z0-9·]{2,20}(?:医院|中心|卫生院|门诊部|诊所))")


def parse_date_str(m: Optional[re.Match]) -> Optional[str]:
    if not m:
        return None
    y = int(m.group(1))
    mo = int(m.group(2))
    d = int(m.group(3))
    if 1 <= mo <= 12 and 1 <= d <= 31:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def find_first(pattern: re.Pattern, text: str, group: int = 0) -> Optional[str]:
    m = pattern.search(text)
    if m:
        return m.group(group) or None
    return None


# ---------------------------------------------------------------------------
# 布局感知的键值提取
# 电子版 PDF / OCR 输出的文本流顺序常与视觉顺序不一致（如"姓名："与人名被拆开），
# 因此先按坐标聚成视觉行，再在行内按 x 轴取"标签右侧最近的值"。
# ---------------------------------------------------------------------------
_FIELD_LABELS: list[tuple[str, list[str]]] = [
    ("patient_name", ["患者姓名", "病人姓名", "婴儿姓名", "姓名"]),
    ("gender", ["性别", "婴儿性别"]),
    ("birth_date", ["出生日期", "出生年月", "出生时间", "生日", "DOB"]),
    ("age", ["年龄"]),
    ("report_date", ["报告时间", "报告日期", "审核时间", "审核日期", "批准时间", "批准日期"]),
    ("other_date", ["接收时间", "接收日期", "采样时间", "采集时间", "标本采取日期",
                    "采血日期", "送检时间", "送检日期", "检验时间", "检验日期"]),
    ("patient_no", ["住院号", "门诊号", "病案号", "病历号"]),
    ("sample_no", ["样本号", "标本号", "条码号"]),
    ("department", ["送检科室", "申请科室", "科室"]),
    ("bed_no", ["床号"]),
    ("specimen", ["标本类型", "样本类型"]),
    ("lab_item", ["检验项目", "检测项目"]),
    ("diagnosis", ["临床诊断", "诊断"]),
    ("doctor", ["送检医生", "申请医生", "送检医师"]),
]
_LABEL_OF: dict[str, str] = {lb: key for key, lbs in _FIELD_LABELS for lb in lbs}
_LABEL_RE = re.compile(
    r"^\s*(" + "|".join(
        sorted((re.escape(lb) for _, lbs in _FIELD_LABELS for lb in lbs), key=len, reverse=True)
    ) + r")\s*[:：]?\s*(.*)$"
)

# 姓名位置的非法值：其它字段名、机构/编号类词汇
_BAD_NAME_WORDS = re.compile(
    r"(医院|科室|号|日期|时间|性别|年龄|生日|标本|样本|条码|诊断|医生|检验|审核|项目|结果|单位|参考|范围|周期|类别|类型|备注|说明|报告单)"
)
_NAME_OK = re.compile(r"^[\u4e00-\u9fa5A-Za-z·•]{2,15}$")
_DATE_ANY = re.compile(
    r"((?:19|20)\d{2})\s*[年./\-]\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})\s*日?"
    r"(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?"
)
_RE_LABELED_DATE = re.compile(
    r"(?:报告时间|报告日期|审核时间|审核日期|批准时间|批准日期|接收时间|采样时间|采集时间|"
    r"标本采取日期|送检日期|检验日期)\s*[:：]?\s*((?:19|20)\d{2}\s*[年./\-]\s*\d{1,2}\s*[月./\-]\s*\d{1,2}\s*日?"
    r"(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?)"
)


def match_label(text: str) -> tuple[Optional[str], str]:
    """匹配形如『姓名：』『性别：女』的单元格。返回 (字段key, 同行内联值)。"""
    m = _LABEL_RE.match(text or "")
    if not m:
        return None, ""
    return _LABEL_OF[m.group(1)], (m.group(2) or "").strip()


def parse_date_loose(text: str) -> Optional[str]:
    """从任意字符串中解析出日期（支持 2026-08-30 16:45 / 2026/8/30 / 2026年8月30日）。"""
    if not text:
        return None
    m = _DATE_ANY.search(text)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if 1 <= mo <= 12 and 1 <= d <= 31 and 1900 <= y <= 2200:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def _clean_name(value: str) -> Optional[str]:
    v = (value or "").strip()
    v = re.sub(r"^[:：\s]+", "", v)
    if not v:
        return None
    if match_label(v)[0]:  # 值是另一个字段名 -> 该值无效
        return None
    if _BAD_NAME_WORDS.search(v):
        return None
    if not _NAME_OK.match(v):
        return None
    return v


def extract_kv(pages: list[list[Line]]) -> dict[str, str]:
    """基于坐标从每页提取字段键值（标签右/下方取值），返回 {字段key: 值文本}。"""
    kv: dict[str, str] = {}
    for page in pages:
        if not page:
            continue
        # 患者信息区可能横跨表格双栏的分割线，这里直接用整页行聚类，
        # 依赖"标签右侧/下方就近取值"即可正确配对
        for column in [page]:
            rows = cluster_rows(column)
            for row in rows:
                cells = row.sorted_cells()
                for i, cell in enumerate(cells):
                    key, inline = match_label(cell.text)
                    if not key:
                        continue
                    value = inline
                    if not value:
                        # 收集标签右侧连续的非标签单元格（遇到下一个字段标签即止），
                        # 如"检验项目：CK-MB mass 病人类别：…" -> "CK-MB mass"。
                        # 含冒号的粘连文本（如"女性别："、"10编号："）视为其它字段，停止。
                        collected: list[str] = []
                        for nxt in cells[i + 1:]:
                            if nxt.x0 < cell.x1 - 1.5:
                                continue
                            if match_label(nxt.text)[0] or re.search(r"[:：]", nxt.text):
                                break
                            collected.append(nxt.text)
                        value = " ".join(collected).strip()
                    if not value:
                        value = _value_below(column, row, cell)
                    value = (value or "").strip()
                    if value and key not in kv:
                        kv[key] = value
    return kv


def _value_below(page: list[Line], row, label_cell: Line, max_dy: float = 26.0) -> str:
    """标签同行右侧无值时，取标签正下方最接近的单元格。"""
    best, best_score = "", 1e18
    h = max(label_cell.y1 - label_cell.y0, 6.0)
    for ln in page:
        if ln is label_cell:
            continue
        dy = ln.y0 - label_cell.y1
        if dy < -h * 0.5 or dy > max_dy:
            continue
        dx = abs(ln.x0 - label_cell.x0)
        if dx > 80:
            continue
        score = dy + dx * 0.5
        if score < best_score and not match_label(ln.text)[0]:
            best, best_score = ln.text, score
    return best


def _pick_report_date(kv: dict[str, str], text: str) -> Optional[str]:
    """报告日期：优先『报告/审核时间』，其次『接收/采样时间』，最后才是正文首个日期。"""
    for key in ("report_date", "other_date"):
        d = parse_date_loose(kv.get(key, ""))
        if d:
            return d
    m = _RE_LABELED_DATE.search(text or "")
    if m:
        d = parse_date_loose(m.group(1))
        if d:
            return d
    for line in (text or "").splitlines():
        if any(w in line for w in ("出生", "生日", "年龄", "打印")):
            continue
        d = parse_date_loose(line)
        if d:
            return d
    return parse_date_loose(text or "")


_TYPE_BLOCK = re.compile(
    r"[:：]$|结果|单位|参考|范围|区间|周期|类别|类型|标本|样本|条码|床号|住院|门诊|"
    r"医生|科室|项目|编号|姓名|性别|年龄|生日|日期|时间|备注|诊断"
)
_SPECIMEN_VALUES = re.compile(r"^(静脉血|末梢血|血清|血浆|全血|尿液|粪便|咽拭子|胸水|腹水|脑脊液)$")


def _valid_lab_item(text: str) -> bool:
    """『检验项目：』的值能否作为报告类型。

    允许组合项目名（如"离子测定2,UA,Cr(血液),AST"、"AMY（血液）"、"CK-MB mass"），
    但排除其它字段名、表头词、标本值与整句描述。
    """
    t = (text or "").strip()
    if not (2 <= len(t) <= 40):
        return False
    if not re.search(r"[\u4e00-\u9fa5]", t) and len(t) < 5:
        return False  # "mass" 之类从项目名上脱落的孤立尾词
    if re.search(r"[。；;？?！!]", t):  # 整句特征（组合名中的半角逗号允许）
        return False
    if _TYPE_BLOCK.search(t):
        return False
    if match_label(t)[0] or _SPECIMEN_VALUES.match(t):
        return False
    return True


def _gender_from_layout(pages: list[list[Line]]) -> Optional[str]:
    """性别兜底：在含"性别"字样的视觉行内就近查找男/女（值可能在标签左侧或粘连带前缀）。"""
    for page in pages:
        if not page:
            continue
        for column in page_column_groups(page):
            for row in cluster_rows(column):
                cells = row.sorted_cells()
                gcell = next((c for c in cells if "性别" in c.text), None)
                if gcell is None:
                    continue
                m = re.search(r"[男女]", gcell.text)
                if m:
                    return m.group(0)
                cand = []
                for other in cells:
                    if other is gcell:
                        continue
                    m2 = re.search(r"[男女]", other.text)
                    if m2:
                        cand.append((abs(other.x0 - gcell.x1), m2.group(0)))
                if cand:
                    cand.sort()
                    return cand[0][1]
    return None


def _valid_filename_lab(stem: str) -> bool:
    """上传文件名中的项目名校验（比正文提取宽松：文件名即用户命名的项目名）。"""
    t = (stem or "").strip()
    if not (2 <= len(t) <= 40):
        return False
    if re.search(r"[。；;？?！!]", t):
        return False
    if _TYPE_BLOCK.search(t):
        return False
    if match_label(t)[0] or _SPECIMEN_VALUES.match(t):
        return False
    return True


def _extract_patient_meta(pages: list[list[Line]], text: str,
                          template: dict | None = None,
                          source_name: Optional[str] = None) -> dict:
    tpl_patient = (template or {}).get("patient") or {}
    out: dict = {"patient_name": None, "gender": None, "birth_date": None,
                 "report_date": None, "report_type": None, "hospital": None}

    def _regex(name: str, default: Optional[re.Pattern]):
        pat = tpl_patient.get(name)
        if pat:
            try:
                return re.compile(pat)
            except re.error:
                return default
        return default

    # 双通道提取：整页行聚类 + 分栏行聚类。不同版式的标签/值错位方式不同，
    # 两通道各取通过有效性校验的结果，互为兜底。
    kv = extract_kv(pages) if pages else {}
    kv2 = extract_kv([c for page in pages for c in page_column_groups(page)]) if pages else {}

    def pick(key: str, validator) -> str:
        for src in (kv, kv2):
            v = (src.get(key) or "").strip()
            if v and validator(v):
                return v
        return ""

    out["patient_name"] = _clean_name(pick("patient_name", lambda v: bool(_clean_name(v))))

    g = (kv.get("gender") or kv2.get("gender") or "").strip()
    m_gender = re.search(r"[男女]", g)
    out["gender"] = m_gender.group(0) if m_gender else find_first(
        _regex("gender_regex", _RE_GENDER), text, 1)
    if not out["gender"]:
        out["gender"] = _gender_from_layout(pages)

    # 报告类型优先级：报告单"检验项目："处的项目组名称 > 专用模板固定类型 > 关键词推断 > 兜底
    lab_item = re.sub(r"\s+\d{1,3}$", "", re.sub(r"[\s，,；;、.。]+$", "",
                      pick("lab_item", _valid_lab_item))).strip()
    if lab_item and _valid_lab_item(lab_item):
        out["report_type"] = lab_item
    has_match_words = bool(((template or {}).get("match") or {}).get("text_contains"))
    if not out["report_type"] and has_match_words and (template or {}).get("report_type"):
        out["report_type"] = template["report_type"]
    if not out["report_type"]:
        out["report_type"] = _infer_report_type(text)
    # 兜底：从上传文件名提取项目名（如 "19CK-MB mass 901.pdf" -> "CK-MB mass"）
    if not out["report_type"] and source_name:
        stem = re.sub(r"\.(pdf|png|jpe?g|webp|bmp)$", "", source_name, flags=re.I)
        stem = re.sub(r"\s*\d{2,4}\s*$", "", stem)
        stem = re.sub(r"^\d+[\s._-]*", "", stem).strip()
        if _valid_filename_lab(stem):
            out["report_type"] = stem
    if not out["report_type"]:
        out["report_type"] = tpl_patient.get("report_type") or "检验"

    out["birth_date"] = parse_date_loose(pick("birth_date", lambda v: bool(parse_date_loose(v)))) \
        or parse_date_str(_regex("birth_regex", _RE_BIRTH).search(text))

    out["report_date"] = _pick_report_date(kv, text) or _pick_report_date(kv2, text)
    if not out["report_date"]:
        out["report_date"] = parse_date_str(_regex("date_regex", _RE_DATE).search(text))

    if not out["patient_name"]:
        for m in re.finditer(_regex("name_regex", _RE_NAME), text):
            g2 = next((x for x in m.groups() if x), None)
            if g2 and _clean_name(g2):
                out["patient_name"] = _clean_name(g2)
                break

    out["hospital"] = find_first(_RE_HOSPITAL, text, 1)
    return out


def _infer_report_type(text: str) -> Optional[str]:
    text = normalize_text(text)
    for key, tp in [
        (("骨髓",), "骨髓细胞学"),
        (("形态学",), "外周血细胞形态学"),
        (("血常规", "血细胞分析"), "血常规"),
        (("生化",), "生化检验"),
        (("尿常规",), "尿常规"),
        (("肝功能",), "肝功能"),
        (("肾功能",), "肾功能"),
        (("凝血",), "凝血检验"),
        (("超声", "彩超"), "超声检查"),
        (("CT",), "CT检查"),
        (("X线", "X-Ray", "DR"), "X线检查"),
        (("磁共振", "MRI"), "磁共振检查"),
        (("病理",), "病理报告"),
        (("血糖",), "血糖检验"),
        (("心肌酶",), "心肌酶"),
        (("甲功", "甲状腺"), "甲状腺功能"),
        (("免疫",), "免疫检验"),
        (("肿瘤标志", "肿瘤标志物"), "肿瘤标志物"),
        (("血型",), "血型鉴定"),
        (("尿常规", "尿液分析"), "尿常规"),
    ]:
        if any(k in text for k in key):
            return tp
    return None


# ---------------------------------------------------------------------------
# 单元格解析
# ---------------------------------------------------------------------------
def _strip_arrow_marks(t: str) -> str:
    """去掉高低箭头标记（↑↓ 只是异常标记，不属于检查结果内容）。

    保留 < > ≤ ≥ 这类具有临床含义的边界符号。
    """
    return re.sub(r"[↑↓]", "", t).strip()


def parse_value_cell(value_text: str) -> tuple[str, Optional[float], str]:
    """解析数值单元格 -> (结果文本(不含箭头), 数值或None, 异常提示)。"""
    t = (value_text or "").strip()
    if not t:
        return t, None, ""
    # 纯箭头行（数值在其它列，交由调用方跳过）
    if t in ("↑", "H", "偏高", "高"):
        return t, None, "high"
    if t in ("↓", "L", "偏低", "低"):
        return t, None, "low"

    arrow_hint = "high" if "↑" in t else ("low" if "↓" in t else "")
    m = _VALUE_WITH_MARK.match(t)
    if m:
        prefix = m.group(1)
        num = _clean_num(m.group(2))
        arrow = m.group(3) or ""
        flag_hint = ""
        if prefix in ("<", "≤"):
            flag_hint = "low" if prefix == "<" else ""
        elif prefix in (">", "≥"):
            flag_hint = "high" if prefix == ">" else ""
        elif prefix == "↑":
            flag_hint = "high"
        elif prefix == "↓":
            flag_hint = "low"
        elif arrow in ("↑", "H"):
            flag_hint = "high"
        elif arrow in ("↓", "L"):
            flag_hint = "low"
        return _strip_arrow_marks(t), num, flag_hint or arrow_hint
    # 定性/带符号结果（如 "3+↑"、"阴性"）：去掉箭头，保留箭头对应的异常提示
    return _strip_arrow_marks(t) or t, None, arrow_hint


def parse_ref_cell(ref_text: str) -> tuple[str, Optional[float], Optional[float], Optional[str]]:
    """解析参考区间 -> (清洗后文本, ref_low, ref_high, 单边方向)。"""
    t = (ref_text or "").strip()
    if not t:
        return "", None, None, None
    m = _REF_RANGE.match(t)
    if m:
        low, high = _clean_num(m.group(1)), _clean_num(m.group(2))
        return t, min(low, high), max(low, high), None
    m2 = _REF_SINGLE_LOW.match(t)
    if m2:
        num = _clean_num(m2.group(1))
        # 形如 "<3.0" / ">10" 视为边界
        if t.startswith(("<", "≤")):
            return t, None, num, "low_than_high"  # 值须低于该上限
        if t.startswith((">", "≥")):
            return t, num, None, "greater_than_low"
        return t, None, num, None
    return t, None, None, None


# ---------------------------------------------------------------------------
# 行聚类：把坐标文本行按视觉行归并
# ---------------------------------------------------------------------------
class _Row:
    __slots__ = ("cells", "ymin", "ymax", "x0", "x1", "href")

    def __init__(self, ln: Line) -> None:
        self.cells: list[Line] = [ln]
        self.ymin = ln.y0
        self.ymax = ln.y1
        self.x0 = ln.x0
        self.x1 = ln.x1
        self.href = max(ln.y1 - ln.y0, 1.0)  # 行内基准高度

    def add(self, ln: Line) -> None:
        self.cells.append(ln)
        self.ymin = min(self.ymin, ln.y0)
        self.ymax = max(self.ymax, ln.y1)
        self.x0 = min(self.x0, ln.x0)
        self.x1 = max(self.x1, ln.x1)

    def sorted_cells(self) -> list[Line]:
        return sorted(self.cells, key=lambda c: c.x0)

    def text(self) -> str:
        return " ".join(c.text for c in self.sorted_cells())


def cluster_rows(lines: list[Line], y_overlap_ratio: float = 0.45) -> list[_Row]:
    """把坐标文本行按视觉行归并。

    归并条件为"垂直重叠达到较矮一方的 y_overlap_ratio"，比旧的"间隙邻近"更严格，
    可避免密集表格被连锁合并成一行。
    """
    rows: list[_Row] = []
    for ln in sorted(lines, key=lambda l: (l.y0, l.x0)):
        h = max(ln.y1 - ln.y0, 1.0)
        placed = False
        for r in reversed(rows):
            overlap = min(ln.y1, r.ymax) - max(ln.y0, r.ymin)
            if overlap >= y_overlap_ratio * min(h, r.href):
                r.add(ln)
                placed = True
                break
        if not placed:
            rows.append(_Row(ln))
    return rows


def split_by_headers(page: list[Line], columns: list[dict] | None = None) -> Optional[list[list[Line]]]:
    """同一视觉行出现两组表头（左右双栏表格）时按 x 切分页面。

    适用于印章/水印文字填满栏间空隙、投影法失效的情况：
    只要"项目名称"在同一行出现两次，即以两组表头之间的空隙为分界。
    """
    cols = columns or _DEFAULT_COLUMNS
    if not page or len(page) < 8:
        return None
    for row in cluster_rows(page):
        item_cells: list[Line] = []
        for c in row.sorted_cells():
            n = _normal_alias(c.text)
            for col in cols:
                if col["key"] != "item":
                    continue
                if any(_normal_alias(a) and (n == _normal_alias(a) or n.startswith(_normal_alias(a))
                                             or n.endswith(_normal_alias(a)) or _normal_alias(a) in n)
                       for a in col.get("aliases", [])):
                    item_cells.append(c)
                    break
        # 同一行内 x 相距较远的多个"项目名称" -> 双栏
        uniq: list[Line] = []
        for c in sorted(item_cells, key=lambda x: x.x0):
            if not uniq or c.x0 - uniq[-1].x0 > 40:
                uniq.append(c)
        if len(uniq) < 2:
            continue
        right_item_x = uniq[1].x0
        cells = row.sorted_cells()
        left_max = max((c.x1 for c in cells if c.x1 <= right_item_x), default=None)
        right_min = min((c.x0 for c in cells if c.x0 >= right_item_x), default=None)
        if left_max is None or right_min is None or right_min <= left_max:
            continue
        split = (left_max + right_min) / 2
        left = [ln for ln in page if ln.x1 <= split]
        right = [ln for ln in page if ln.x0 >= split]
        if len(left) >= 3 and len(right) >= 3:
            return [left, right]
    return None


def page_column_groups(page: list[Line], columns: list[dict] | None = None) -> list[list[Line]]:
    """优先按重复表头切分双栏，其次按贯通空白带切分，失败则原样返回。"""
    return split_by_headers(page, columns) or split_page_columns(page) or [page]


def split_page_columns(page: list[Line], max_depth: int = 2) -> list[list[Line]]:
    """检测并切分多栏页面（如左右并排的两张检验表）。

    判据：存在几乎垂直贯通的空白带（覆盖该 x 区间的文本行占比很低），且两侧都有足量内容。
    单栏页面原样返回。
    """
    if not page:
        return [page]

    def _split(lines: list[Line], depth: int) -> list[list[Line]]:
        if depth <= 0 or len(lines) < 8:
            return [lines]
        x_min = min(ln.x0 for ln in lines)
        x_max = max(ln.x1 for ln in lines)
        width = x_max - x_min
        if width <= 0:
            return [lines]
        intervals = sorted((ln.x0, ln.x1) for ln in lines)
        merged: list[list[float]] = []
        for s, e in intervals:
            if merged and s <= merged[-1][1] + 0.5:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        best_x: Optional[float] = None
        best_gap = 0.0
        for i in range(len(merged) - 1):
            gs, ge = merged[i][1], merged[i + 1][0]
            gap = ge - gs
            if gap < width * 0.04:
                continue
            cover = sum(1 for ln in lines if ln.x0 < ge and ln.x1 > gs)
            if cover > len(lines) * 0.12:  # 有内容横跨该带 -> 不是分栏线
                continue
            left = [ln for ln in lines if ln.x1 <= ge]
            right = [ln for ln in lines if ln.x0 >= gs]
            if len(left) < 3 or len(right) < 3:
                continue
            if gap > best_gap:
                best_gap, best_x = gap, (gs + ge) / 2
        if best_x is None:
            return [lines]
        left = [ln for ln in lines if ln.x1 <= best_x]
        right = [ln for ln in lines if ln.x0 >= best_x]
        if not left or not right:
            return [lines]
        return _split(left, depth - 1) + _split(right, depth - 1)

    return _split(page, max_depth)


def _normal_alias(cell_text: str) -> str:
    return normalize_text(cell_text)


def _find_header_row(rows: list[_Row], columns: list[dict]) -> tuple[Optional[_Row], dict[str, float]]:
    """在若干行中定位表头，返回(表头行, {列key: 中心x})。表头要求同时命中“项目”与“结果”列。"""
    for row in rows:
        anchors: dict[str, float] = {}
        for cell in row.sorted_cells():
            n = _normal_alias(cell.text)
            for col in columns:
                key = col["key"]
                if key in anchors:
                    continue
                for alias in col.get("aliases", []):
                    if not alias:
                        continue
                    a = _normal_alias(alias)
                    if n == a or n.startswith(a) or n.endswith(a) or a in n:
                        cx = (cell.x0 + cell.x1) / 2
                        anchors[key] = cx
                        break
        has_item = "item" in anchors
        has_value = "value" in anchors
        # 表头特征：同时出现"检验项目"与"结果"，或至少命中 3 个以上列名
        if (has_item and has_value) or len(anchors) >= 3:
            return row, anchors
    return None, {}


def _nearest_column(cx: float, anchors: dict[str, float]) -> str:
    best, best_d = "item", 1e18
    for key, ax in anchors.items():
        d = abs(cx - ax)
        if d < best_d:
            best, best_d = key, d
    return best


def _parse_table_page(rows: list[_Row], columns: list[dict]) -> list[dict]:
    """在单页内解析：找到表头 -> 其后数据行按表头列锚点归类成记录。"""
    records: list[dict] = []
    header, anchors = _find_header_row(rows, columns)
    if not header:
        return records
    start = False
    for row in rows:
        if row is header:
            start = True
            continue
        if not start:
            continue
        # 新的表头（多页/续表）
        again, new_anchors = _find_header_row([row], columns)
        if again:
            anchors = new_anchors
            continue
        bucket: dict[str, list[str]] = {}
        for cell in row.sorted_cells():
            cx = (cell.x0 + cell.x1) / 2
            key = _nearest_column(cx, anchors)
            bucket.setdefault(key, []).append(cell.text)
        rec = {k: " ".join(v).strip() for k, v in bucket.items()}
        if rec.get("value") is None:
            rec["value"] = ""
        records.append(rec)
    return records


def _flag_from_text(t: str) -> str:
    n = _normal_alias(t)
    for arrow, flag in _ARROWS.items():
        if arrow in n:
            return flag
    return ""


def _compute_flag(value_num: Optional[float], ref_low: Optional[float], ref_high: Optional[float],
                  hint: str = "") -> str:
    if hint:
        return hint
    if value_num is None:
        return "normal"
    if ref_high is not None and value_num > ref_high:
        return "high"
    if ref_low is not None and value_num < ref_low:
        return "low"
    return "normal"


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def parse_document(pages: list[list[Line]], template: dict | None,
                   raw_text: Optional[str] = None,
                   source_name: Optional[str] = None) -> dict:
    """pages: 每页一个 Line 列表；template 可为空（用默认规则兜底）。"""
    all_lines = [ln for page in pages for ln in page]
    text = raw_text
    if text is None:
        text = "\n".join(ln.text for ln in all_lines)

    tpl = template or {}
    item_cfg = tpl.get("items") or {}
    meta = _extract_patient_meta(pages, text, template, source_name=source_name)

    items: list[dict] = []
    seen: set[str] = set()
    warnings: list[str] = []

    if item_cfg.get("mode") == "none":
        # 影像/自由文本报告：仅归档元信息，不抽取数值型检验结果
        pass
    elif item_cfg.get("mode") == "text_kv":
        # 文字型项目（如外周血形态学、脑脊液细胞学）：按模板声明的标签抽取"项目+描述"，
        # 模板标签未命中时自动发现（避免同类报告换个名称就抽不到）
        labels = item_cfg.get("labels") or []
        if labels:
            _collect_text_kv(pages, labels, items, seen)
        if not items:
            _collect_text_kv(pages, [], items, seen)
    else:
        _collect_table_items(pages, columns=item_cfg.get("columns"), items=items, seen=seen)

    _warnings_meta(meta, items, warnings, text_only=(item_cfg.get("mode") == "none"))
    return {
        **meta,
        "template_id": tpl.get("id"),
        "template_name": tpl.get("name"),
        "items": items,
        "confidence": _confidence(meta, items),
        "warnings": warnings,
    }


# 定性结果（阴性/阳性/正常…）后面常跟随"等级/着色强度"等其它列的内容
_QUALITATIVE_HEAD = re.compile(r"^(阴性|阳性|弱阳性|正常|异常|未见|可见|未检出|检出)(?:[（(].*?[）)])?$")


def trim_qualitative_value(value: str) -> str:
    """结果单元格混入后续列内容时，仅保留开头的定性结果词。"""
    parts = (value or "").split()
    if len(parts) > 1 and _QUALITATIVE_HEAD.match(parts[0]):
        return parts[0]
    return value


# 备注/声明/页脚等非检验行：出现在表格尾部时会被误当作检测项目
_NOISE_ITEM = re.compile(
    r"(注\s*[:：]|备注|说明|声明|提示[:：]|结论|意见[:：]|建议|方法学|本报告|仅对|仅供参考|"
    r"如有疑问|质评|省内参考|以下空白|检验者|审核者|送检医生|采样时间|采集时间|接收时间|报告时间|"
    r"标本类型|病人类别|病人类型|临床诊断|生理周期|科室[:：]|床号|住院号|样本号|条码号|编号[:：])"
)
_TABLE_END = re.compile(r"(本报告|仅对.{0,6}标本|如有疑问|以下空白|注\s*[:：])")
_SENTENCE_PUNCT = re.compile(r"[，,。；;、？?！!]")


def is_noise_item(item: str) -> bool:
    """判断一行是否为备注/声明类噪声，而非检验项目。"""
    t = (item or "").strip()
    if not t:
        return True
    if len(t) > 24:
        return True
    if re.fullmatch(r"[\d:./\-～~]+", t):  # 纯时间/数字串不是项目名
        return True
    if _NOISE_ITEM.search(t):
        return True
    # 检验项目名不会包含句中逗号/句号（括号内的间隔号除外）
    if _SENTENCE_PUNCT.search(re.sub(r"[（(][^）)]*[）)]", "", t)):
        return True
    return False


def _collect_table_items(pages, columns, items: list[dict], seen: set[str]) -> None:
    cols = columns or _DEFAULT_COLUMNS
    for page in pages:
        if not page:
            continue
        for column in page_column_groups(page):
            rows = cluster_rows(column)
            records = _parse_table_page(rows, cols)
            for rec in records:
                value_raw, value_num, hint = parse_value_cell(rec.get("value", ""))
                item = rec.get("item", "")
                if not item.strip() or value_raw in ("", "↓", "↑", "-"):
                    continue
                if is_noise_item(item):
                    # 备注/声明出现即视为表格结束
                    if _TABLE_END.search(item):
                        break
                    continue
                # 去掉质评星号等前缀/后缀标记
                item = re.sub(r"^[\s*※#▲△]+", "", item)
                item = re.sub(r"[\s*※#▲△]+$", "", item).strip()
                if not item:
                    continue
                value_raw = trim_qualitative_value(value_raw)
                ref_text, ref_low, ref_high, _ = parse_ref_cell(rec.get("ref", ""))
                unit = rec.get("unit", "").strip()
                cell_flag = rec.get("flag", "") or ""
                hint = _flag_from_text(cell_flag) or hint
                flag = _compute_flag(value_num, ref_low, ref_high, hint)
                norm = normalize_text(item)
                if not norm or norm in seen:
                    continue
                seen.add(norm)
                items.append({
                    "item": item,
                    "value_text": value_raw,
                    "value_num": value_num,
                    "unit": unit,
                    "ref_text": ref_text,
                    "ref_low": ref_low,
                    "ref_high": ref_high,
                    "flag": flag,
                })


_FOOTER_LINE = re.compile(
    r"采集时间|接收时间|报告时间|检验者|审核者|送检医生|第\s*\d+\s*页|质评|实验室地址|"
    r"注\s*[:：]|本报告|仅对")


_BAD_LABEL_WORDS = re.compile(
    r"(注|编号|样本|条码|检验|审核|接收|报告|采集|标本|参考|结果|项目|单位|提示|备注|"
    r"结论|意见|地址|电话|医院|科室|日期|时间|姓名|性别|年龄|生日|床号|类别|类型)"
)
_LABEL_LINE = re.compile(r"^([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,12})\s*[:：]\s*(.*)$")


def discover_text_labels(pages) -> list[str]:
    """自动发现文字型报告的『项目名：描述』标签（用于模板未声明 labels 时）。"""
    found: list[str] = []
    for page in pages or []:
        if not page:
            continue
        for column in page_column_groups(page):
            for row in cluster_rows(column):
                txt = row.text().strip()
                if not txt or _TABLE_END.search(txt) or _FOOTER_LINE.search(txt):
                    continue
                m = _LABEL_LINE.match(txt)
                if not m:
                    continue
                lab = m.group(1).strip()
                if match_label(txt)[0] or _BAD_LABEL_WORDS.search(lab):
                    continue
                if lab not in found:
                    found.append(lab)
    return found


def _collect_text_kv(pages, labels: list[str], items: list[dict], seen: set[str]) -> None:
    """文字型项目抽取：模板声明 labels（如 白细胞形态/红细胞形态/血小板形态），
    值为标签行冒号后的内容及其后续行，直到下一个标签或页脚。
    labels 为空时自动发现「项目名：描述」标签。"""
    if not labels:
        labels = discover_text_labels(pages)
    for page in pages:
        if not page:
            continue
        for column in page_column_groups(page):
            flat = [r.text().strip() for r in cluster_rows(column) if r.text().strip()]
            n = len(flat)
            idx = 0
            while idx < n:
                txt = flat[idx]
                lab = next((l for l in labels if txt.startswith(l)), None)
                if not lab:
                    idx += 1
                    continue
                rest = re.sub(r"^[:：\s]+", "", txt[len(lab):]).strip()
                parts = [rest] if rest else []
                j = idx + 1
                while j < n:
                    nxt = flat[j]
                    if any(nxt.startswith(l) for l in labels):
                        break
                    if _TABLE_END.search(nxt) or _FOOTER_LINE.search(nxt):
                        break
                    parts.append(nxt)
                    j += 1
                value = " ".join(p for p in parts if p).strip()
                if value:
                    norm = normalize_text(lab)
                    if norm and norm not in seen:
                        seen.add(norm)
                        items.append({
                            "item": lab, "value_text": value, "value_num": None,
                            "unit": "", "ref_text": "", "ref_low": None,
                            "ref_high": None, "flag": "normal",
                        })
                idx = max(j, idx + 1)


def _warnings_meta(meta: dict, items: list[dict], warnings: list[str], text_only: bool = False) -> None:
    if not meta["report_date"]:
        warnings.append("未识别到报告日期，请在校对时补充")
    if not meta["patient_name"]:
        warnings.append("未识别到患者姓名，请在校对时补充")
    if not items and not text_only:
        warnings.append("未能按模板提取到检验结果：可能版式不匹配，可选择其他模板或手工录入")


def _confidence(meta: dict, items: list[dict]) -> float:
    c = 0.0
    if meta["patient_name"]:
        c += 0.4
    if meta["report_date"]:
        c += 0.25
    if items:
        c += 0.3
    if meta["report_type"]:
        c += 0.05
    return round(min(c, 1.0), 2)


_DEFAULT_COLUMNS = [
    {"key": "item", "aliases": ["检验项目", "项目名称", "测定项目", "检查项目", "实验项目", "项目", "指标"]},
    {"key": "value", "aliases": ["检验结果", "测定结果", "本次结果", "结果"]},
    {"key": "unit", "aliases": ["单位"]},
    {"key": "ref", "aliases": ["参考范围", "参考区间", "参考值", "参考", "正常范围", "范围", "区间"]},
    {"key": "flag", "aliases": ["提示", "标志", "标记", "箭头"]},
    {"key": "method", "aliases": ["方法学", "检测方法", "方法"]},
    # 占位列：避免备注/实验日期等内容混入结果或参考范围
    {"key": "extra", "aliases": ["备注", "附注", "实验日期", "打印日期"]},
]
