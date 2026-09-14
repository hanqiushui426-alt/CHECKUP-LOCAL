"""后端轻量 i18n：接口提示与导出表头跟随前端语言。

只翻译面向用户的提示文案；识别规则（parser/模板）与业务数据保持原样。
"""
from __future__ import annotations

from typing import Optional

from fastapi import Query, Request

LANGS = ("zh-CN", "en-US")

STRINGS: dict[str, dict[str, str]] = {
    "zh-CN": {
        "report.notFound": "报告不存在",
        "report.noSource": "该报告没有源文件，无法重新解析",
        "report.sourceMissing": "源文件已缺失，无法重新解析",
        "report.nameRequired": "未能识别到患者姓名，无法重新归集",
        "trend.noData": "该项目暂无趋势数据",
        "log.import": "导入批次「{batch}」：{n} 个文件",
        "log.importRejected": "导入批次「{batch}」：{n} 个文件，{r} 个被拒绝",
        "log.archive": "报告「{file}」入库，归集到患者「{patient}」（{n} 项）",
        "log.edit": "编辑报告「{file}」，归属患者「{patient}」（{n} 项）",
        "log.deleteReport": "删除报告「{file}」（原归属：{patient}）",
        "log.deletePatient": "删除患者档案 #{id}",
        "log.deletePatientWithReports": "删除患者档案 #{id}（含其名下报告）",
        "log.merge": "合并患者档案：#{from} 并入「{to}」",
        "log.patientNew": "新建患者档案「{name}」",
        "log.reparseOne": "重新解析报告「{file}」",
        "log.confirmManual": "确认报告「{file}」中的 {n} 项人工修改",
        "log.reparseAll": "批量重新解析 {n} 份报告：成功 {ok}，失败 {failed}",
        "patient.notFound": "患者不存在",
        "patient.nameRequired": "患者姓名不能为空",
        "patient.mergeInvalid": "合并对象无效",
        "review.notFound": "记录不存在",
        "review.nameRequired": "请填写患者姓名后再确认入库",
        "task.notFound": "任务不存在",
        "batch.notFound": "批次不存在",
        "template.notFound": "模板不存在",
        "template.nameRequired": "请填写模板名称",
        "noFiles": "未选择任何文件",
        "invalidFile": "不支持的文件类型",
        "parseFailed": "解析失败",
        "archived": "报告已入库",
        # Excel 导出
        "sheet.results": "检验结果明细",
        "sheet.trend": "指标趋势序列",
        "col.patient": "患者",
        "col.gender": "性别",
        "col.reportDate": "报告日期",
        "col.testItem": "检验项目",
        "col.hospital": "医院",
        "col.item": "检验项目",
        "col.value": "结果",
        "col.valueNum": "数值",
        "col.unit": "单位",
        "col.ref": "参考区间",
        "col.refLow": "参考下限",
        "col.refHigh": "参考上限",
        "col.flag": "异常",
        "col.source": "来源文件",
        "col.reportType": "报告类型",
        "col.highPoint": "偏高点（绘图辅助）",
        "col.lowPoint": "偏低点（绘图辅助）",
        "sheet.summary": "全部明细",
        "export.noItems": "请至少选择一个检验项目",
    },
    "en-US": {
        "report.notFound": "Report not found",
        "report.noSource": "This report has no source file, cannot re-parse",
        "report.sourceMissing": "Source file is missing, cannot re-parse",
        "report.nameRequired": "Patient name not recognized — cannot regroup",
        "trend.noData": "No trend data for this item",
        "log.import": "Import batch “{batch}”: {n} files",
        "log.importRejected": "Import batch “{batch}”: {n} files, {r} rejected",
        "log.archive": "Report “{file}” archived under patient “{patient}” ({n} items)",
        "log.edit": "Edited report “{file}”, patient “{patient}” ({n} items)",
        "log.deleteReport": "Deleted report “{file}” (was assigned to: {patient})",
        "log.deletePatient": "Deleted patient record #{id}",
        "log.deletePatientWithReports": "Deleted patient record #{id} (including its reports)",
        "log.merge": "Merged patient record #{from} into “{to}”",
        "log.patientNew": "Created patient record “{name}”",
        "log.reparseOne": "Re-parsed report “{file}”",
        "log.confirmManual": "Confirmed {n} manual edit(s) in “{file}”",
        "log.reparseAll": "Batch re-parse of {n} reports: {ok} succeeded, {failed} failed",
        "patient.notFound": "Patient not found",
        "patient.nameRequired": "Patient name is required",
        "patient.mergeInvalid": "Invalid merge target",
        "review.notFound": "Record not found",
        "review.nameRequired": "Enter the patient name before archiving",
        "task.notFound": "Task not found",
        "batch.notFound": "Batch not found",
        "template.notFound": "Template not found",
        "template.nameRequired": "Template name is required",
        "noFiles": "No files selected",
        "invalidFile": "Unsupported file type",
        "parseFailed": "Parsing failed",
        "archived": "Report archived",
        "sheet.results": "Test result details",
        "sheet.trend": "Indicator trend series",
        "col.patient": "Patient",
        "col.gender": "Gender",
        "col.reportDate": "Report date",
        "col.testItem": "Test item",
        "col.hospital": "Hospital",
        "col.item": "Test item",
        "col.value": "Result",
        "col.valueNum": "Value",
        "col.unit": "Unit",
        "col.ref": "Reference range",
        "col.refLow": "Reference low",
        "col.refHigh": "Reference high",
        "col.flag": "Flag",
        "col.source": "Source file",
        "col.reportType": "Report type",
        "col.highPoint": "High points (chart helper)",
        "col.lowPoint": "Low points (chart helper)",
        "sheet.summary": "All details",
        "export.noItems": "Select at least one test item",
    },
}


def normalize(lang: Optional[str]) -> str:
    if lang:
        low = lang.lower()
        if low.startswith("zh"):
            return "zh-CN"
        if low.startswith("en"):
            return "en-US"
    return "zh-CN"


def tr(lang: Optional[str], key: str, **vars) -> str:
    """按语言取文案，缺失时回退中文。"""
    table = STRINGS.get(normalize(lang)) or STRINGS["zh-CN"]
    s = table.get(key) or STRINGS["zh-CN"].get(key) or key
    for k, v in vars.items():
        s = s.replace(f"{{{k}}}", str(v))
    return s


def get_lang(request: Request, lang: Optional[str] = Query(None)) -> str:
    """语言依赖：优先 ?lang=，其次 Accept-Language 请求头。"""
    header = request.headers.get("accept-language", "")
    return normalize(lang or header.split(",")[0])
