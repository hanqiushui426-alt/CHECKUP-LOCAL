import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Pencil, RefreshCw, Star, Trash2, TrendingUp, Users } from "lucide-react";
import { api, notify, toastError } from "../api";
import { EChart, fmt } from "../components/chart";
import { Badge, Card, Empty, Modal, Spinner, cn } from "../components/ui";
import { sortItems, useDirectory } from "../components/directory";
import { postExport } from "../utils/download";
import { useI18n } from "../i18n";
import type { ExportPreset, TrendPoint } from "../types";

export default function TrendsPage() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const dir = useDirectory();

  const pid = dir.trendPatientId;
  const item = dir.trendItem;
  const items = useMemo(() => sortItems(dir.trendItems), [dir.trendItems]);
  const patient = dir.patients.find((p) => p.id === pid) || null;

  const [data, setData] = useState<{ meta: any; series: TrendPoint[] } | null>(null);
  const [loadingTrend, setLoadingTrend] = useState(false);

  // 批量导出相关
  const [sel, setSel] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [exporting, setExporting] = useState(false);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  // 目录选中患者后，默认选中第一个项目（有异常的优先）
  useEffect(() => {
    if (!pid || !items.length) return;
    if (!item || !items.some((x) => x.item === item)) {
      dir.selectTrendItem(items[0].item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, items]);

  useEffect(() => {
    if (!pid || !item) { setData(null); return; }
    setLoadingTrend(true);
    api.get<{ meta: any; series: TrendPoint[] }>(
      `/api/stats/trend?patient_id=${pid}&item=${encodeURIComponent(item)}`)
      .then(setData).catch((e) => { setData(null); toastError(e); })
      .finally(() => setLoadingTrend(false));
  }, [pid, item]);

  // 切换患者时清空批量勾选
  useEffect(() => { setSel([]); }, [pid]);

  const chart = useMemo(() => buildOption(data, t), [data, t]);

  const filtered = useMemo(() => {
    const k = kw.trim();
    return k ? items.filter((it) => it.item.includes(k)) : items;
  }, [items, kw]);

  function openBatch() {
    if (!sel.length && item) setSel([item]);
    setKw("");
    setPresetOpen(false);
    setPresetName("");
    setBatchOpen(true);
    api.get<{ items: ExportPreset[] }>("/api/export/presets")
      .then((r) => setPresets(r.items))
      .catch(() => {});
  }

  /** 应用常用项目组：与当前患者的检验项目取交集 */
  function applyPreset(p: ExportPreset) {
    const available = new Set(items.map((x) => x.item));
    const hit = p.items.filter((x) => available.has(x));
    const missed = p.items.length - hit.length;
    setSel((prev) => Array.from(new Set([...prev, ...hit])));
    notify(missed
      ? t("trend.batch.presetAppliedMiss", { n: hit.length, m: missed })
      : t("trend.batch.presetApplied", { n: hit.length }), "success");
    setPresetOpen(false);
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) { notify(t("trend.batch.presetNeedName"), "error"); return; }
    if (!sel.length) { notify(t("trend.batch.needOne"), "error"); return; }
    try {
      const p = await api.post<ExportPreset>("/api/export/presets", { name, items: sel, lang });
      setPresets((prev) => [p, ...prev]);
      setPresetName("");
      notify(t("trend.batch.presetSaved"), "success");
    } catch (e) {
      toastError(e);
    }
  }

  async function updatePreset(p: ExportPreset, e: React.MouseEvent) {
    e.stopPropagation();
    if (!sel.length) { notify(t("trend.batch.needOne"), "error"); return; }
    try {
      await api.put(`/api/export/presets/${p.id}`, { name: p.name, items: sel });
      setPresets((prev) => prev.map((x) => (x.id === p.id ? { ...x, items: [...sel] } : x)));
      notify(t("trend.batch.presetUpdated"), "success");
    } catch (err) {
      toastError(err);
    }
  }

  async function deletePreset(p: ExportPreset, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.del(`/api/export/presets/${p.id}`);
      setPresets((prev) => prev.filter((x) => x.id !== p.id));
      notify(t("trend.batch.presetDeleted"), "info");
    } catch (err) {
      toastError(err);
    }
  }

  async function exportBatch() {
    if (!sel.length) { notify(t("trend.batch.needOne"), "error"); return; }
    setExporting(true);
    try {
      await postExport("/api/export/items.xlsx", { patient_id: pid, items: sel, lang });
      notify(t("trend.batch.done"), "success");
      setBatchOpen(false);
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Card title={patient ? `${patient.name} · ${item || t("trend.itemPlaceholder")}` : t("trend.title")}
        extra={<Badge tone="teal"><TrendingUp className="w-3 h-3 mr-1" />{t("trend.badge")}</Badge>}>
        <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
          <span className="text-xs text-ink-faint mr-auto">
            {t("trend.unit", { unit: data?.meta?.unit || "—" })}
          </span>
          {items.length > 0 && (
            <button className="btn-ghost" onClick={openBatch}>
              <Download className="w-4 h-4" />{t("trend.batch")}
            </button>
          )}
        </div>

        {!pid ? (
          <Empty text={t("trend.emptyPatient")} />
        ) : !items.length ? (
          <Empty text={t("trend.emptyItems", { name: patient?.name || "" })} />
        ) : loadingTrend ? (
          <Spinner text={t("trend.calculating")} />
        ) : data ? (
          <>
            <EChart option={chart.option} height={372} />
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><i className="w-3 h-1 bg-primary-600 rounded-full inline-block" />{t("trend.legend.measured")}</span>
              {chart.hasRef ? (
                <span className="inline-flex items-center gap-1.5"><i className="w-3 h-2.5 bg-amber-300/60 border border-amber-500 rounded-sm inline-block" />{t("trend.legend.refBand")}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-600">{t("trend.noRef")}</span>
              )}
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 bg-danger rounded-full inline-block" />{t("trend.legend.high")}</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 bg-info rounded-full inline-block" />{t("trend.legend.low")}</span>
            </div>
          </>
        ) : null}
      </Card>

      {data && (
        <Card title={t("trend.detailTitle", { item: data.meta.item })} extra={<Badge tone="blue"><Users className="w-3 h-3 mr-1" />{t("trend.records", { n: data.series.length })}</Badge>}>
          <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0"><tr>
                <th className="th">{t("trend.col.date")}</th><th className="th">{t("trend.col.value")}</th><th className="th">{t("trend.col.unit")}</th>
                <th className="th">{t("trend.col.ref")}</th><th className="th">{t("trend.col.status")}</th><th className="th">{t("trend.col.source")}</th>
                <th className="th w-10"></th>
              </tr></thead>
              <tbody>
                {data.series.map((p) => (
                  <tr key={p.report_id}
                    title={t("trend.clickToEdit")}
                    onClick={() => nav(`/patients?patient=${pid}&report=${p.report_id}&item=${encodeURIComponent(p.item)}`)}
                    className={cn("cursor-pointer transition hover:bg-slate-100/70",
                      p.flag === "high" ? "bg-red-50/50" : p.flag === "low" ? "bg-primary-50/40" : "")}>
                    <td className="td font-medium">{p.report_date}</td>
                    <td className="td font-semibold">{p.value_text}{p.flag === "high" ? " ↑" : p.flag === "low" ? " ↓" : ""}</td>
                    <td className="td text-ink-soft">{p.unit}</td>
                    <td className="td text-ink-soft">{p.ref_text || "—"}</td>
                    <td className="td">{p.flag === "normal" ? <span className="text-good">{t("trend.normal")}</span> :
                      <Badge tone={p.flag === "high" ? "red" : "blue"}>{p.flag === "high" ? t("trend.high") : t("trend.low")}</Badge>}</td>
                    <td className="td text-ink-faint text-xs truncate max-w-[220px]">{p.report_type} · {p.source_filename}</td>
                    <td className="td text-right"><Pencil className="w-3.5 h-3.5 text-slate-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {batchOpen && (
        <Modal title={t("trend.batch.title")} onClose={() => setBatchOpen(false)} width="max-w-2xl"
          footer={
            <>
              <button className="btn-ghost" onClick={() => setBatchOpen(false)} disabled={exporting}>{t("ui.cancel")}</button>
              <button className="btn-primary" onClick={exportBatch} disabled={exporting}>
                <Download className="w-4 h-4" />
                {exporting ? t("trend.batch.exporting") : t("trend.batch.confirm", { n: sel.length })}
              </button>
            </>}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <input className="input !w-44" value={kw} placeholder={t("trend.batch.filter")}
              onChange={(e) => setKw(e.target.value)} />

            <div className="relative">
              <button className="btn-ghost whitespace-nowrap" onClick={() => setPresetOpen((v) => !v)}>
                <Star className="w-3.5 h-3.5" />{t("trend.batch.presets")}
              </button>
              {presetOpen && (
                <>
                  <div className="fixed inset-0 z-[94]" onClick={() => setPresetOpen(false)} />
                  <div className="absolute left-0 mt-1 w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-2 z-[95]">
                    <button className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 text-sm cursor-pointer"
                      onClick={() => { setSel(filtered.map((i) => i.item)); setPresetOpen(false); }}>
                      {t("trend.batch.selectFiltered", { n: filtered.length })}
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    {presets.length === 0 ? (
                      <div className="px-2.5 py-2 text-xs text-ink-faint">{t("trend.batch.presetEmpty")}</div>
                    ) : presets.map((p) => (
                      <div key={p.id} className="flex items-center gap-1 rounded-lg hover:bg-slate-50">
                        <button className="flex-1 text-left px-2.5 py-2 text-sm truncate cursor-pointer"
                          title={p.items.join("、")} onClick={() => applyPreset(p)}>
                          {p.name}
                          <span className="text-[11px] text-ink-faint ml-1">（{p.items.length}）</span>
                        </button>
                        <button className="p-1 text-slate-300 hover:text-primary-600 cursor-pointer"
                          title={t("trend.batch.presetUpdateTip")} onClick={(e) => updatePreset(p, e)}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1 text-slate-300 hover:text-danger cursor-pointer"
                          title={t("trend.batch.presetDelete")} onClick={(e) => deletePreset(p, e)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <div className="flex items-center gap-1 p-1">
                      <input className="input !py-1 text-xs" value={presetName}
                        placeholder={t("trend.batch.presetName")}
                        onChange={(e) => setPresetName(e.target.value)} />
                      <button className="btn-ghost !py-1 whitespace-nowrap" onClick={savePreset}>
                        {t("trend.batch.presetSave")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button className="btn-ghost whitespace-nowrap" onClick={() => setSel(items.map((i) => i.item))}>{t("trend.batch.allAll", { n: items.length })}</button>
            <button className="btn-ghost whitespace-nowrap" onClick={() => setSel([])}>{t("trend.batch.none")}</button>
            <span className="text-xs text-ink-faint whitespace-nowrap">{t("trend.batch.selected", { n: sel.length })}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-[52vh] overflow-y-auto pr-1">
            {filtered.map((it) => {
              const checked = sel.includes(it.item);
              return (
                <label key={it.item}
                  className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer text-sm transition",
                    checked ? "border-primary-200 bg-primary-50/60" : "border-slate-100 hover:bg-slate-50")}>
                  <input type="checkbox" className="accent-primary-600" checked={checked}
                    onChange={() => setSel((prev) => (checked ? prev.filter((x) => x !== it.item) : [...prev, it.item]))} />
                  <span className="truncate">{it.item}</span>
                  <span className="ml-auto text-[11px] text-ink-faint whitespace-nowrap">
                    {it.cnt}{t("trend.times")}{it.abnormal_cnt ? ` · ${it.abnormal_cnt}${t("trend.abnormalTimes")}` : ""}
                  </span>
                </label>
              );
            })}
            {!filtered.length && <div className="col-span-2 text-sm text-ink-faint py-6 text-center">{t("trend.batch.empty")}</div>}
          </div>
        </Modal>
      )}
    </>
  );
}

const C_NORMAL = "#0F766E";
const C_HIGH = "#DC2626";
const C_LOW = "#2563EB";
// 参考区间：琥珀色系，与实测线（青）和异常点（红/蓝）区分度高，且保持半透明不遮挡数据
const C_REF = "#F59E0B";
const C_REF_LABEL = "#B45309";
const C_REF_BAND = "rgba(245,158,11,0.18)";

function firstNum(values: (number | null | undefined)[]): number | null {
  for (const v of values) {
    if (v !== null && v !== undefined && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** 构建趋势图配置。返回 { option, hasRef }：hasRef 表示该项目是否带参考范围。 */
function buildOption(data: { meta: any; series: TrendPoint[] } | null,
                     t: (k: string) => string): { option: any; hasRef: boolean } {
  if (!data) return { option: {}, hasRef: false };
  const s = data.series;
  const dates = s.map((p) => p.report_date);
  const colorOf = (f: string) => (f === "high" ? C_HIGH : f === "low" ? C_LOW : C_NORMAL);

  const refLow = firstNum(s.map((p) => p.ref_low));
  const refHigh = firstNum(s.map((p) => p.ref_high));
  const hasRef = refLow !== null || refHigh !== null;

  const points = s.map((p) => {
    const abnormal = p.flag === "high" || p.flag === "low";
    return {
      value: p.value_num,
      symbolSize: abnormal ? 12 : 7,
      itemStyle: {
        color: colorOf(p.flag),
        borderColor: abnormal ? "#FFFFFF" : "transparent",
        borderWidth: abnormal ? 2 : 0,
      },
    };
  });

  // 参考上下限：水平虚线 + 区间底色带
  const markLineData: any[] = [];
  if (refHigh !== null) {
    markLineData.push({
      yAxis: refHigh, name: t("trend.legend.refHigh"),
      lineStyle: { color: C_REF, type: "dashed", width: 1.5 },
      label: {
        formatter: t("trend.legend.refHigh"), position: "insideEndTop",
        fontSize: 10, color: "#FFFFFF", backgroundColor: C_REF,
        padding: [2, 4], borderRadius: 3,
      },
    });
  }
  if (refLow !== null) {
    markLineData.push({
      yAxis: refLow, name: t("trend.legend.refLow"),
      lineStyle: { color: C_REF, type: "dashed", width: 1.5 },
      label: {
        formatter: t("trend.legend.refLow"), position: "insideEndBottom",
        fontSize: 10, color: "#FFFFFF", backgroundColor: C_REF,
        padding: [2, 4], borderRadius: 3,
      },
    });
  }

  const option = {
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: any) => (v === null || v === undefined || v === "" ? "—" : fmt.format(Number(v))),
    },
    // 图例统一由页面下方自定义渲染，避免与 ECharts 内置图例重复
    legend: { show: false },
    grid: { left: 52, right: 24, top: 24, bottom: 28 },
    xAxis: { type: "category", data: dates, boundaryGap: false, axisLabel: { color: "#64748B", fontSize: 11 } },
    yAxis: {
      type: "value", scale: true, name: data.meta.unit || "",
      nameTextStyle: { color: "#94A3B8" },
      axisLabel: { color: "#64748B", fontSize: 11 },
      splitLine: { lineStyle: { color: "#EEF2F7" } },
    },
    series: [
      {
        name: t("trend.legend.measured"),
        type: "line",
        data: points,
        connectNulls: false,
        symbol: "circle",
        smooth: 0.25,
        lineStyle: { width: 2.5, color: C_NORMAL },
        areaStyle: { opacity: 0.06, color: "#14B8A6" },
        markLine: markLineData.length ? { silent: true, symbol: "none", data: markLineData } : undefined,
        markArea: (refLow !== null && refHigh !== null)
          ? {
            silent: true,
            itemStyle: { color: C_REF_BAND },
            data: [[{ yAxis: refLow }, { yAxis: refHigh }]],
          }
          : undefined,
      },
    ],
  };
  return { option, hasRef };
}
