import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, ChevronDown, Download, FileDown, FileText, Languages, LineChart, Plus,
  Search, ShieldCheck, UploadCloud, Users,
} from "lucide-react";
import { api, notify, toastError } from "../api";
import { cn } from "./ui";
import { LANGS, useI18n, type Lang } from "../i18n";
import { sortItems, useDirectory } from "./directory";
import { postExport } from "../utils/download";
import type { Patient, PatientItemStat } from "../types";

const NAV_TOP = [
  { to: "/", key: "nav.dashboard", icon: Activity, end: true },
  { to: "/import", key: "nav.import", icon: UploadCloud },
];

export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const loc = useLocation();
  const go = useNavigate();
  const dir = useDirectory();

  const inPatients = loc.pathname.startsWith("/patients");
  const inTrends = loc.pathname.startsWith("/trends");

  const [openLib, setOpenLib] = useState(inPatients);
  const [openTrend, setOpenTrend] = useState(inTrends);
  const [kwLib, setKwLib] = useState("");
  const [kwTrend, setKwTrend] = useState("");
  const [busy, setBusy] = useState(false);

  // 进入对应页面时自动展开该目录
  useEffect(() => { if (inPatients) setOpenLib(true); }, [inPatients]);
  useEffect(() => { if (inTrends) setOpenTrend(true); }, [inTrends]);

  const libList = useMemo(() => {
    const k = kwLib.trim();
    return k ? dir.patients.filter((p) => (p.name || "").includes(k)) : dir.patients;
  }, [dir.patients, kwLib]);

  const trendPatients = useMemo(() => {
    const k = kwTrend.trim();
    return dir.patients
      .filter((p) => (p.report_count || 0) > 0)
      .filter((p) => !k || (p.name || "").includes(k));
  }, [dir.patients, kwTrend]);

  /** 检验项目：有异常的优先 + 次数多的在前；支持关键词过滤 */
  const trendItems = useMemo(() => {
    const k = kwTrend.trim();
    const sorted = sortItems(dir.trendItems);
    return k ? sorted.filter((i) => i.item.includes(k)) : sorted;
  }, [dir.trendItems, kwTrend]);

  /** 批量导出某位患者的全部检验项目（一个 Excel，每个项目一个 sheet） */
  async function exportPatient(p: Patient) {
    try {
      setBusy(true);
      const its = await api.get<PatientItemStat[]>(`/api/stats/items?patient_id=${p.id}`);
      if (!its.length) { notify(t("trend.batch.needOne"), "error"); return; }
      await postExport("/api/export/items.xlsx", {
        patient_id: p.id, items: its.map((x) => x.item), lang,
      });
      notify(t("layout.exported"), "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  /** 导出单个检验项目的历次序列 */
  function exportOne(p: Patient, item: string) {
    window.open(`/api/export/trend.xlsx?patient_id=${p.id}`
      + `&item=${encodeURIComponent(item)}&lang=${lang}`, "_blank");
  }

  const activeLabel = (() => {
    const p = loc.pathname;
    if (p === "/") return t("nav.dashboard");
    if (p.startsWith("/import")) return t("nav.import");
    if (p.startsWith("/patients")) return t("nav.patients");
    if (p.startsWith("/trends")) return t("nav.trends");
    return t("nav.templates");
  })();

  return (
    <div className="flex h-full min-h-screen">
      <aside className="fixed left-0 top-0 h-full w-[272px] bg-white/90 backdrop-blur border-r border-slate-100 flex flex-col z-20">
        <div className="px-5 h-16 flex items-center gap-2.5 border-b border-slate-100">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white grid place-items-center shadow-card">
            <Activity className="w-4.5 h-4.5" />
          </span>
          <div className="leading-tight">
            <div className="font-bold text-[15px] text-ink">{t("layout.brand")}</div>
            <div className="text-[10px] text-primary-700/80 tracking-wider">CHECKUP · LOCAL</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {/* 顶部两项 + 患者库 / 趋势分析（后两项带折叠目录） */}
          {NAV_TOP.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              onClick={() => window.dispatchEvent(new CustomEvent("app:refresh"))}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition mb-0.5",
                isActive ? "bg-primary-50 text-primary-800 font-medium shadow-sm"
                  : "text-ink-soft hover:bg-slate-50 hover:text-ink")}>
              <n.icon className="w-4 h-4" />
              {t(n.key)}
            </NavLink>
          ))}

          {/* ===== 患者库：可展开的患者目录 ===== */}
          <button onClick={() => { setOpenLib((v) => !v); if (!inPatients) go("/patients"); }}
            className={cn("w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition mb-0.5",
              inPatients ? "bg-primary-50 text-primary-800 font-medium shadow-sm"
                : "text-ink-soft hover:bg-slate-50 hover:text-ink")}>
            <Users className="w-4 h-4" />
            {t("nav.patients")}
            <ChevronDown className={cn("ml-auto w-3.5 h-3.5 transition", !openLib && "-rotate-90")} />
          </button>
          {openLib && (
            <div className="ml-3 pl-2.5 border-l border-dashed border-slate-200 mb-2">
              <div className="relative my-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
                <input className="input !py-1.5 !pl-8 text-xs" value={kwLib}
                  placeholder={t("dir.searchPatient")} onChange={(e) => setKwLib(e.target.value)} />
              </div>
              <div className="max-h-[240px] overflow-y-auto pr-0.5 space-y-0.5">
                {libList.map((p) => (
                  <button key={p.id}
                    onClick={() => { dir.selectPatient(p); if (!inPatients) go("/patients"); }}
                    className={cn("w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                      inPatients && dir.patientId === p.id
                        ? "bg-primary-50 text-primary-800 font-medium"
                        : "text-ink-soft hover:bg-slate-50")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                      (p.report_count || 0) > 0 ? "bg-primary-500" : "bg-slate-300")} />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] text-ink-faint whitespace-nowrap">
                      {p.report_count ?? 0} {t("patients.reportsUnit")}
                    </span>
                  </button>
                ))}
                {!libList.length && (
                  <div className="text-[11px] text-ink-faint px-2 py-3 text-center">{t("dir.noPatient")}</div>
                )}
              </div>
              <button className="btn-ghost w-full justify-center mt-1.5 !py-1 text-xs"
                onClick={() => {
                  if (!inPatients) {
                    go("/patients");
                    // 等患者库页面挂载后再触发弹窗
                    setTimeout(() => dir.newPatientRef.current?.(), 220);
                  } else {
                    dir.newPatientRef.current?.();
                  }
                }}>
                <Plus className="w-3.5 h-3.5" />{t("patients.new")}
              </button>
            </div>
          )}

          {/* ===== 趋势分析：二级（患者）→ 三级（检验项目） ===== */}
          <button onClick={() => { setOpenTrend((v) => !v); if (!inTrends) go("/trends"); }}
            className={cn("w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition mb-0.5",
              inTrends ? "bg-primary-50 text-primary-800 font-medium shadow-sm"
                : "text-ink-soft hover:bg-slate-50 hover:text-ink")}>
            <LineChart className="w-4 h-4" />
            {t("nav.trends")}
            <ChevronDown className={cn("ml-auto w-3.5 h-3.5 transition", !openTrend && "-rotate-90")} />
          </button>
          {openTrend && (
            <div className="ml-3 pl-2.5 border-l border-dashed border-slate-200 mb-2">
              <div className="relative my-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
                <input className="input !py-1.5 !pl-8 text-xs" value={kwTrend}
                  placeholder={t("dir.searchPatientItem")} onChange={(e) => setKwTrend(e.target.value)} />
              </div>
              <div className="max-h-[220px] overflow-y-auto pr-0.5">
                {trendPatients.map((p) => {
                  const open = dir.trendPatientId === p.id;
                  return (
                    <div key={p.id}>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => { dir.selectTrendPatient(p); if (!inTrends) go("/trends"); }}
                          className={cn("flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs min-w-0",
                            open ? "bg-primary-50 text-primary-800 font-medium" : "text-ink-soft hover:bg-slate-50")}>
                          <ChevronDown className={cn("w-3 h-3 shrink-0 text-slate-300 transition",
                            !open && "-rotate-90")} />
                          <span className="truncate">{p.name}</span>
                          <span className="ml-auto text-[10px] text-ink-faint whitespace-nowrap">
                            {p.report_count ?? 0}
                          </span>
                        </button>
                        <button className="p-1 rounded-md text-slate-300 hover:text-primary-700 hover:bg-primary-50 disabled:opacity-40"
                          disabled={busy} title={t("dir.exportPatient")} onClick={() => exportPatient(p)}>
                          <FileDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {open && (
                        <div className="ml-2.5 pl-2 border-l border-dashed border-slate-200">
                          {/* 超过 10 项时：固定高度的滚动窗口 */}
                          <div className="max-h-[262px] overflow-y-auto pr-0.5">
                            {trendItems.map((it) => (
                              <div key={it.item} className="flex items-center gap-0.5">
                                <button
                                  onClick={() => { dir.selectTrendItem(it.item); if (!inTrends) go("/trends"); }}
                                  title={it.item}
                                  className={cn("flex-1 flex items-center gap-1 rounded-md px-2 py-1 text-left text-[11.5px] min-w-0",
                                    dir.trendItem === it.item
                                      ? "bg-primary-50 text-primary-800 font-medium"
                                      : "text-ink-soft hover:bg-slate-50")}>
                                  <span className="truncate">{it.item}</span>
                                  <span className="ml-auto text-[10px] text-ink-faint whitespace-nowrap">{it.cnt}</span>
                                  {it.abnormal_cnt > 0 && (
                                    <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1 whitespace-nowrap">
                                      {it.abnormal_cnt}
                                    </span>
                                  )}
                                </button>
                                <button className="p-1 rounded-md text-slate-300 hover:text-primary-700 hover:bg-primary-50"
                                  title={t("dir.exportItem")} onClick={() => exportOne(p, it.item)}>
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            {!trendItems.length && (
                              <div className="text-[11px] text-ink-faint px-2 py-3 text-center">{t("dir.noItem")}</div>
                            )}
                          </div>
                          <div className="text-[10px] text-ink-faint px-2 pt-1 mt-1 border-t border-dashed border-slate-200">
                            {t("dir.itemCount", { n: dir.trendItems.length })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!trendPatients.length && (
                  <div className="text-[11px] text-ink-faint px-2 py-3 text-center">{t("dir.noPatient")}</div>
                )}
              </div>
            </div>
          )}
        </nav>

        <div className="px-4 pb-3">
          <div className="rounded-xl bg-primary-50/70 border border-primary-100 p-3 flex gap-2 text-[11px] text-primary-800 leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-primary-600" />
            <span>{t("layout.privacy")}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-2 py-1.5">
            <Languages className="w-3.5 h-3.5 text-primary-600 shrink-0" />
            <select className="w-full bg-transparent text-[11px] text-ink-soft outline-none cursor-pointer"
              value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("layout.language")}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
        </div>
      </aside>

      <div className="flex-1 ml-[272px] min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 h-16 bg-white/75 backdrop-blur border-b border-slate-100 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <FileText className="w-4 h-4 text-primary-600" />
            <span className="font-medium text-ink">{activeLabel}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <span className="hidden sm:inline">{t("layout.storage")}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-good animate-pulse" />
            <span className="text-good">{t("layout.running")}</span>
          </div>
        </header>
        <main className="flex-1 p-6 space-y-5 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
