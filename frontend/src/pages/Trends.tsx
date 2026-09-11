import { useEffect, useMemo, useState } from "react";
import { Download, TrendingUp, Users } from "lucide-react";
import { api, notify, toastError } from "../api";
import { EChart, fmt } from "../components/chart";
import { Badge, Card, Empty, Modal, SearchSelect, Spinner, cn, useAppRefresh } from "../components/ui";
import { useI18n } from "../i18n";
import type { Patient, PatientItemStat, TrendPoint } from "../types";

export default function TrendsPage() {
  const { t, lang } = useI18n();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [pid, setPid] = useState<number | "">("");
  const [items, setItems] = useState<PatientItemStat[]>([]);
  const [item, setItem] = useState("");
  const [data, setData] = useState<{ meta: any; series: TrendPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(false);

  // 批量导出相关
  const [sel, setSel] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [exporting, setExporting] = useState(false);

  async function loadPatients() {
    const r = await api.get<{ items: Patient[] }>("/api/patients?limit=1000");
    setPatients(r.items);
    if (r.items.length === 1) setPid((p) => (p === "" ? r.items[0].id : p));
  }

  useEffect(() => {
    loadPatients().catch(toastError).finally(() => setLoading(false));
  }, []);

  // 切换左侧栏目时自动刷新患者与项目列表（保持当前选择）
  useAppRefresh(() => {
    loadPatients().catch(() => {});
    if (pid !== "") {
      api.get<PatientItemStat[]>(`/api/stats/items?patient_id=${pid}`).then(setItems).catch(() => {});
    }
  });

  useEffect(() => {
    setData(null); setItem(""); setSel([]);
    if (pid === "") { setItems([]); return; }
    api.get<PatientItemStat[]>(`/api/stats/items?patient_id=${pid}`).then((r) => {
      setItems(r);
      if (r.length) setItem(r[0].item);
    }).catch(toastError);
  }, [pid]);

  useEffect(() => {
    if (pid === "" || !item) { setData(null); return; }
    setLoadingTrend(true);
    api.get<{ meta: any; series: TrendPoint[] }>(
      `/api/stats/trend?patient_id=${pid}&item=${encodeURIComponent(item)}`)
      .then(setData).catch((e) => { setData(null); toastError(e); })
      .finally(() => setLoadingTrend(false));
  }, [pid, item]);

  const patient = patients.find((p) => p.id === pid);
  const chart = useMemo(() => buildOption(data, t), [data, t]);

  const filtered = useMemo(() => {
    const k = kw.trim();
    return k ? items.filter((it) => it.item.includes(k)) : items;
  }, [items, kw]);

  function openBatch() {
    if (!sel.length && item) setSel([item]);
    setKw("");
    setBatchOpen(true);
  }

  async function exportBatch() {
    if (!sel.length) { notify(t("trend.batch.needOne"), "error"); return; }
    setExporting(true);
    try {
      const res = await fetch("/api/export/items.xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: pid, items: sel, lang }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 120) || "导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `检验项目_${patient?.name || pid}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(t("trend.batch.done"), "success");
      setBatchOpen(false);
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <Card title={t("trend.title")} extra={<Badge tone="teal"><TrendingUp className="w-3 h-3 mr-1" />{t("trend.badge")}</Badge>}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <label className="block"><span className="label">{t("trend.patient")}</span>
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("ui.pleaseSelect")}</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}{p.gender ? "（" + p.gender + "）" : ""}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">{t("trend.item")}</span>
            <SearchSelect value={item} disabled={!items.length} placeholder={t("trend.itemPlaceholder")}
              options={items.map((it) => ({
                value: it.item,
                label: `${it.item}（${it.cnt} ${t("trend.times")}${it.abnormal_cnt ? ` · ${it.abnormal_cnt} ${t("trend.abnormalTimes")}` : ""}）`,
              }))}
              onChange={setItem} />
          </label>
          <div className="col-span-2 flex items-end gap-3 flex-wrap">
            {data && (
              <button className="btn-primary"
                onClick={() => window.open(`/api/export/trend.xlsx?patient_id=${pid}&item=${encodeURIComponent(item)}&lang=${lang}`, "_blank")}>
                <Download className="w-4 h-4" />{t("trend.export")}
              </button>
            )}
            {items.length > 0 && (
              <button className="btn-ghost" onClick={openBatch}>
                <Download className="w-4 h-4" />{t("trend.batch")}
              </button>
            )}
            <span className="text-xs text-ink-faint mb-2.5">
              {t("trend.unit", { unit: data?.meta?.unit || "—" })}
            </span>
          </div>
        </div>

        {!pid ? (
          <Empty text={t("trend.emptyPatient")} />
        ) : !items.length ? (
          <Empty text={t("trend.emptyItems", { name: patient?.name || "" })} />
        ) : loadingTrend ? (
          <Spinner text={t("trend.calculating")} />
        ) : data ? (
          <>
            <EChart option={chart.option} height={360} />
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
              </tr></thead>
              <tbody>
                {data.series.map((p) => (
                  <tr key={p.report_id} className={p.flag === "high" ? "bg-red-50/50" : p.flag === "low" ? "bg-primary-50/40" : ""}>
                    <td className="td font-medium">{p.report_date}</td>
                    <td className="td font-semibold">{p.value_text}{p.flag === "high" ? " ↑" : p.flag === "low" ? " ↓" : ""}</td>
                    <td className="td text-ink-soft">{p.unit}</td>
                    <td className="td text-ink-soft">{p.ref_text || "—"}</td>
                    <td className="td">{p.flag === "normal" ? <span className="text-good">{t("trend.normal")}</span> :
                      <Badge tone={p.flag === "high" ? "red" : "blue"}>{p.flag === "high" ? t("trend.high") : t("trend.low")}</Badge>}</td>
                    <td className="td text-ink-faint text-xs truncate max-w-[220px]">{p.report_type} · {p.source_filename}</td>
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
          <div className="flex items-center gap-2 mb-3">
            <input className="input" value={kw} placeholder={t("trend.batch.filter")}
              onChange={(e) => setKw(e.target.value)} />
            <button className="btn-ghost whitespace-nowrap" onClick={() => setSel(filtered.map((i) => i.item))}>{t("trend.batch.all")}</button>
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
