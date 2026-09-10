import { useEffect, useMemo, useState } from "react";
import { Download, TrendingUp, Users } from "lucide-react";
import { api, toastError } from "../api";
import { EChart, fmt } from "../components/chart";
import { Badge, Card, Empty, SearchSelect, Spinner, useAppRefresh } from "../components/ui";
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
    setData(null); setItem("");
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
  const option = useMemo(() => buildOption(data, t), [data, t]);

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
          <div className="col-span-2 flex items-end gap-3">
            {data && (
              <button className="btn-primary"
                onClick={() => window.open(`/api/export/trend.xlsx?patient_id=${pid}&item=${encodeURIComponent(item)}&lang=${lang}`, "_blank")}>
                <Download className="w-4 h-4" />{t("trend.export")}
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
            <EChart option={option} height={360} />
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><i className="w-3 h-1 bg-primary-600 rounded-full inline-block" />{t("trend.legend.measured")}</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-3 h-1 bg-slate-300 rounded-full inline-block" />{t("trend.legend.reference")}</span>
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
    </>
  );
}

function buildOption(data: { meta: any; series: TrendPoint[] } | null,
                     t: (k: string) => string): any {
  if (!data) return {};
  const s = data.series;
  const dates = s.map((p) => p.report_date);
  const colorOf = (f: string) => (f === "high" ? "#DC2626" : f === "low" ? "#2563EB" : "#0F766E");
  return {
    tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt.format(Number(v)) },
    legend: { show: true, bottom: 0, textStyle: { fontSize: 11, color: "#64748B" } },
    grid: { left: 46, right: 20, top: 24, bottom: 46 },
    xAxis: { type: "category", data: dates, boundaryGap: false, axisLabel: { color: "#64748B", fontSize: 11 } },
    yAxis: {
      type: "value", scale: true, name: data.meta.unit || "",
      nameTextStyle: { color: "#94A3B8" },
      axisLabel: { color: "#64748B", fontSize: 11 },
      splitLine: { lineStyle: { color: "#EEF2F7" } },
    },
    series: [
      {
        name: t("trend.legend.measured"), type: "line", data: s.map((p) => ({
          value: p.value_num, itemStyle: { color: colorOf(p.flag) },
        })),
        connectNulls: false, smooth: 0.25, symbolSize: 7,
        lineStyle: { width: 2.5, color: "#0F766E" },
        areaStyle: { opacity: 0.08, color: "#14B8A6" },
      },
      {
        name: t("trend.legend.refLow"), type: "line", data: s.map((p) => p.ref_low),
        lineStyle: { type: "dashed", width: 1, color: "#94A3B8" }, symbol: "none", silent: true,
      },
      {
        name: t("trend.legend.refHigh"), type: "line", data: s.map((p) => p.ref_high),
        lineStyle: { type: "dashed", width: 1, color: "#94A3B8" }, symbol: "none", silent: true,
      },
    ],
  };
}
