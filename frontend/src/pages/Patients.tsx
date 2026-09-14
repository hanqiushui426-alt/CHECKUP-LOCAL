import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Calendar, FileText, Pencil, Plus, RefreshCw, Search, Trash2, UserRound, Users } from "lucide-react";
import { api, notify, toastError } from "../api";
import { Badge, Card, ConfirmDialog, Empty, Modal, Spinner, cn, useAppRefresh } from "../components/ui";
import ReportEditor from "../components/ReportEditor";
import { useI18n } from "../i18n";
import type { Patient, PendingConfirm, Report, ReviewSummary } from "../types";

interface ReportDetail extends Report { results: any[]; patient: Patient | null }

interface NewPatient { name: string; gender: string; birth_date: string; note: string }

type ConfirmKind =
  | { kind: "delete-patient" }
  | { kind: "delete-report"; report: Report }
  | null;

export default function PatientsPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<Patient | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [dups, setDups] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [openReports, setOpenReports] = useState<Record<number, ReportDetail | null>>({});
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [withReports, setWithReports] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<NewPatient | null>(null);
  const [busyReport, setBusyReport] = useState<number | null>(null);
  const [pending, setPending] = useState<ReviewSummary[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm[]>([]);
  const [editor, setEditor] = useState<{ mode: "report" | "review"; id: number; focusItem?: string } | null>(null);
  const [sp, setSp] = useSearchParams();
  const jumpHandled = useRef(false);

  // 从「趋势分析」跳转进来：/patients?patient=1&report=2&item=白细胞计数
  // 自动选中患者、打开该报告编辑器并定位到该项目
  useEffect(() => {
    if (jumpHandled.current || loading || !list.length) return;
    const pid = Number(sp.get("patient") || 0);
    if (!pid) return;
    jumpHandled.current = true;
    const rid = Number(sp.get("report") || 0);
    const focus = sp.get("item") || undefined;
    const next = new URLSearchParams(sp);
    next.delete("patient"); next.delete("report"); next.delete("item");
    setSp(next, { replace: true });
    const p = list.find((x) => x.id === pid);
    if (p) {
      open(p, list)
        .then(() => { if (rid) setEditor({ mode: "report", id: rid, focusItem: focus }); })
        .catch(toastError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, loading, sp, setSp]);

  const loadPending = useCallback(async () => {
    const r = await api.get<{ items: ReviewSummary[] }>("/api/review?status=pending&limit=200");
    setPending(r.items);
  }, []);

  // 已入库报告中"人工改过、又被重新识别"的待确认项
  const loadPendingConfirm = useCallback(async () => {
    const r = await api.get<{ items: PendingConfirm[] }>("/api/reports/pending-confirm");
    setPendingConfirm(r.items);
  }, []);

  /** 打开某份报告并定位（用于待确认项跳转） */
  async function openReportForConfirm(pid: number | null | undefined, rid: number, item?: string) {
    const p = list.find((x) => x.id === pid);
    if (p) await open(p, list);
    setEditor({ mode: "report", id: rid, focusItem: item });
  }

  async function onEditorSaved() {
    setEditor(null);
    await loadPending().catch(() => {});
    await loadPendingConfirm().catch(() => {});
    const all = await load();
    if (sel) await open(sel, all);
  }

  const load = useCallback(async (kw?: string) => {
    const r = await api.get<{ items: Patient[]; total: number }>(`/api/patients?q=${encodeURIComponent(kw || "")}&limit=1000`);
    setList(r.items); setTotal(r.total);
    return r.items;
  }, []);

  useEffect(() => {
    load().catch(toastError).finally(() => setLoading(false));
    loadPending().catch(() => {});
    loadPendingConfirm().catch(() => {});
  }, [load, loadPending, loadPendingConfirm]);

  // 切换左侧栏目时自动刷新
  useAppRefresh(() => {
    load().catch(() => {});
    loadPending().catch(() => {});
    loadPendingConfirm().catch(() => {});
  });

  async function open(p: Patient, all: Patient[] = list) {
    setSel(p);
    setReports([]);
    setOpenReports({});
    setDups(all.filter((d) => d.id !== p.id && nameSimilar(d.name, p.name)));
    setLoading(true);
    try {
      const rp = await api.get<{ items: Report[] }>(`/api/patients/${p.id}/reports?limit=500`);
      setReports(rp.items);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  }

  async function savePatient() {
    if (!sel) return;
    setBusy(true);
    try {
      await api.put(`/api/patients/${sel.id}`, {
        name: sel.name, gender: sel.gender || "", birth_date: sel.birth_date || "", note: sel.note || "",
      });
      notify(t("patients.savedProfile"), "success");
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createPatient() {
    if (!creating) return;
    if (!creating.name.trim()) { notify(t("patients.needName"), "error"); return; }
    setBusy(true);
    try {
      const p = await api.post<Patient>("/api/patients", {
        name: creating.name.trim(), gender: creating.gender || null,
        birth_date: creating.birth_date || null, note: creating.note || null,
      });
      notify(t("patients.created"), "success");
      setCreating(null);
      const all = await load();
      await open(p, all);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doDeletePatient() {
    if (!sel) return;
    setBusy(true);
    try {
      await api.del(`/api/patients/${sel.id}?with_reports=${withReports ? "true" : "false"}`);
      notify(withReports ? t("patients.deletedWithReports") : t("patients.deletedKeepReports"), "success");
      setConfirm(null); setSel(null); setReports([]);
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doDeleteReport(r: Report) {
    setBusy(true);
    try {
      await api.del(`/api/reports/${r.id}`);
      notify(t("patients.reportDeleted"), "info");
      setConfirm(null);
      if (sel) await open(sel);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reparseReport(r: Report) {
    setBusyReport(r.id);
    try {
      await api.post(`/api/reports/${r.id}/reparse`, {});
      notify(t("patients.reparsed"), "success");
      if (sel) await open(sel);
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusyReport(null);
    }
  }

  async function reparseAll() {
    setBusy(true);
    try {
      const r = await api.post<{ total: number; ok: number; failed: any[] }>("/api/reports/reparse-all", {});
      notify(t("patients.reparseAllDone", { ok: r.ok, failed: r.failed.length }), r.failed.length ? "error" : "success");
      setSel(null);
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function mergeFrom(other: Patient) {
    if (!sel) return;
    setBusy(true);
    try {
      await api.post(`/api/patients/${sel.id}/merge`, { remove_id: other.id });
      notify(t("patients.merged"), "success");
      const all = await load();
      await open(sel, all);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[340px,1fr] gap-5 items-start">
      <Card title={t("patients.title", { n: total })} className="lg:sticky lg:top-20 flex flex-col max-h-[calc(100vh-140px)]"
        extra={<button className="btn-ghost !py-1 !px-2 text-xs" onClick={() =>
          setCreating({ name: "", gender: "", birth_date: "", note: "" })}>
          <Plus className="w-3.5 h-3.5" />{t("patients.new")}</button>}>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input className="input !pl-9" placeholder={t("patients.search")} value={q}
            onChange={(e) => { setQ(e.target.value); load(e.target.value).catch(() => {}); }} />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 -mr-1 pr-1">
          {loading && !sel && <Spinner />}
          {!loading && list.length === 0 && <Empty text={t("patients.empty")} />}
          {list.map((p) => (
            <button key={p.id} onClick={() => open(p)}
              className={cn("w-full text-left rounded-xl border px-3.5 py-3 transition cursor-pointer",
                sel?.id === p.id ? "border-primary-400 bg-primary-50/60" : "border-slate-100 hover:border-slate-200 bg-white")}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink flex items-center gap-2"><UserRound className="w-4 h-4 text-primary-600" />{p.name}</span>
                <Badge tone="teal">{p.report_count} {t("patients.reportsUnit")}</Badge>
              </div>
              <div className="text-xs text-ink-faint mt-1.5 flex items-center gap-3">
                <span>{p.gender || "—"} {p.birth_date ? "· " + p.birth_date : ""}</span>
                {p.last_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{p.last_date}</span>}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-5">
        <Card title={t("patients.pendingTitle", { n: pending.length + pendingConfirm.length })}
          extra={<Badge tone={(pending.length + pendingConfirm.length) ? "amber" : "green"}>
            {(pending.length + pendingConfirm.length) ? t("patients.pendingNeed") : t("patients.pendingNone")}</Badge>}>
          {pending.length === 0 && pendingConfirm.length === 0 ? (
            <div className="text-xs text-ink-faint py-1">
              {t("patients.pendingEmpty")}
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((p) => (
                <button key={p.id} onClick={() => setEditor({ mode: "review", id: p.id })}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3 hover:bg-amber-50 text-left cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {p.patient_name || t("patients.unknownName")} · {p.filename}
                    </div>
                    <div className="text-xs text-ink-faint mt-0.5">
                      {p.report_date || t("patients.noDate")} · {p.report_type || p.template_name || t("patients.noTemplate")} · {t("patients.confidence", { p: Math.round((p.confidence || 0) * 100) })}
                    </div>
                  </div>
                  <Badge tone="amber">{t("patients.goReview")}</Badge>
                </button>
              ))}

              {pendingConfirm.length > 0 && (
                <div className={cn("space-y-2", pending.length > 0 && "pt-2.5 mt-1 border-t border-amber-100")}>
                  <div className="text-xs font-medium text-amber-700">
                    {t("patients.confirmTitle", { n: pendingConfirm.length })}
                  </div>
                  {pendingConfirm.map((p) => (
                    <button key={p.report_id}
                      onClick={() => openReportForConfirm(p.patient_id, p.report_id, p.items[0]?.item)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white px-4 py-3 hover:bg-amber-50 text-left cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">
                          {p.patient_name || t("patients.unknownName")} · {p.source_filename}
                        </div>
                        <div className="text-xs text-ink-faint mt-0.5">
                          {p.report_date || t("patients.noDate")} · {p.report_type || "—"} · {t("patients.confirmCount", { n: p.n })}
                        </div>
                      </div>
                      <Badge tone="amber">{t("patients.goConfirm")}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {!sel ? (
          <Card><Empty text={t("patients.selectHint")} /></Card>
        ) : (
          <>
            <Card title={t("patients.profile")} extra={
              <div className="flex gap-2">
                <button className="btn-ghost !py-1.5" onClick={() => { setSel(null); setReports([]); }}><ArrowLeft className="w-3.5 h-3.5" />{t("patients.back")}</button>
                <button className="btn-danger !py-1.5" onClick={() => setConfirm({ kind: "delete-patient" })}>
                  <Trash2 className="w-3.5 h-3.5" />{t("common.delete")}</button>
              </div>}>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <EditField label={t("patients.name")}><input className="input" value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} /></EditField>
                <EditField label={t("patients.gender")}>
                  <select className="input" value={sel.gender || ""} onChange={(e) => setSel({ ...sel, gender: e.target.value || null })}>
                    <option value="">{t("patients.unknown")}</option><option>{t("patients.male")}</option><option>{t("patients.female")}</option>
                  </select>
                </EditField>
                <EditField label={t("patients.birthDate")}><input className="input" type="date" value={sel.birth_date || ""} onChange={(e) => setSel({ ...sel, birth_date: e.target.value || null })} /></EditField>
                <EditField label={t("patients.note")}><input className="input" value={sel.note || ""} onChange={(e) => setSel({ ...sel, note: e.target.value })} /></EditField>
              </div>
              <button className="btn-primary mt-4" onClick={savePatient} disabled={busy}>{busy ? t("patients.processing") : t("patients.saveProfile")}</button>
              {dups.length > 0 && (
                <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm">
                  <div className="text-amber-700 font-medium mb-2">{t("patients.dupHint")}</div>
                  <div className="space-y-1.5">
                    {dups.map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-amber-800">
                        <span>{d.name}（{d.report_count ?? 0} {t("patients.reportsUnit")}，#{d.id}）</span>
                        <button className="text-primary-700 text-xs underline cursor-pointer" onClick={() => mergeFrom(d)}>{t("patients.mergeInto")}</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card title={t("patients.reportsTitle", { n: reports.length })} extra={
              <div className="flex items-center gap-2">
                <button className="btn-ghost !py-1 !px-2 text-xs" onClick={reparseAll} disabled={busy}
                  title={t("patients.reparseAllTip")}>
                  <RefreshCw className="w-3.5 h-3.5" />{t("patients.reparseAll")}</button>
                <Badge tone="blue"><Users className="w-3 h-3 mr-1" />{t("patients.localOnly")}</Badge>
              </div>}>
              {loading && reports.length === 0 ? <Spinner /> : reports.length === 0 ? (
                <Empty text={t("patients.noReport")} />
              ) : (
                <div className="space-y-2.5">
                  {reports.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-100 overflow-hidden">
                      <div className="flex items-center gap-2 bg-white">
                        <button className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 text-left cursor-pointer"
                          onClick={() => toggleReport(r, openReports, setOpenReports)}>
                          <FileText className="w-4 h-4 text-primary-500 shrink-0" />
                          <span className="font-medium text-ink text-sm">{r.report_date || "未知日期"} · {r.report_type || "检验"}</span>
                          <span className="text-xs text-ink-faint truncate flex-1">{r.hospital || ""} {r.template_name ? "· " + r.template_name : ""}</span>
                          <Badge tone="teal">{r.result_count} 项</Badge>
                        </button>
                        <div className="flex items-center gap-1 pr-2 shrink-0">
                          <button className="p-1.5 text-slate-300 hover:text-primary-600 cursor-pointer" title={t("patients.editReport")}
                            onClick={() => setEditor({ mode: "report", id: r.id })}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button className="p-1.5 text-slate-300 hover:text-primary-600 cursor-pointer" title={t("patients.reparse")}
                            disabled={busyReport === r.id}
                            onClick={() => reparseReport(r)}>
                            <RefreshCw className={cn("w-4 h-4", busyReport === r.id && "animate-spin")} />
                          </button>
                          <button className="p-1.5 text-slate-300 hover:text-danger cursor-pointer" title={t("patients.deleteReport")}
                            onClick={() => setConfirm({ kind: "delete-report", report: r })}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {openReports[r.id] && (
                        <ReportItems report={openReports[r.id]}
                          onEditItem={(item) => setEditor({ mode: "report", id: r.id, focusItem: item })} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {editor && (
        <ReportEditor mode={editor.mode} id={editor.id} focusItem={editor.focusItem}
          onClose={() => setEditor(null)} onSaved={onEditorSaved} />
      )}

      {creating && (
        <Modal title={t("patients.newTitle")} onClose={() => setCreating(null)} footer={
          <>
            <button className="btn-ghost" onClick={() => setCreating(null)}>{t("common.cancel")}</button>
            <button className="btn-primary" onClick={createPatient} disabled={busy}>{t("patients.create")}</button>
          </>}>
          <div className="grid sm:grid-cols-2 gap-3">
            <EditField label={t("patients.nameRequired")}><input className="input" autoFocus value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></EditField>
            <EditField label={t("patients.gender")}>
              <select className="input" value={creating.gender}
                onChange={(e) => setCreating({ ...creating, gender: e.target.value })}>
                <option value="">{t("patients.unknown")}</option><option>{t("patients.male")}</option><option>{t("patients.female")}</option>
              </select>
            </EditField>
            <EditField label={t("patients.birthDate")}><input className="input" type="date" value={creating.birth_date}
              onChange={(e) => setCreating({ ...creating, birth_date: e.target.value })} /></EditField>
            <EditField label={t("patients.note")}><input className="input" value={creating.note}
              onChange={(e) => setCreating({ ...creating, note: e.target.value })} /></EditField>
          </div>
          <p className="text-xs text-ink-faint mt-3">{t("patients.newTip")}</p>
        </Modal>
      )}

      {confirm?.kind === "delete-patient" && sel && (
        <ConfirmDialog title={t("patients.deletePatientTitle")} danger busy={busy} confirmText={t("patients.confirmDelete")}
          onCancel={() => setConfirm(null)} onConfirm={doDeletePatient}
          message={<>{t("patients.deletePatientMsg", { name: sel.name })}</>}>
          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input type="checkbox" className="accent-primary-600" checked={withReports}
              onChange={(e) => setWithReports(e.target.checked)} />
            {t("patients.deleteWithReports", { n: sel.report_count ?? 0 })}
          </label>
        </ConfirmDialog>
      )}

      {confirm?.kind === "delete-report" && (
        <ConfirmDialog title={t("patients.deleteReportTitle")} danger busy={busy} confirmText={t("patients.confirmDelete")}
          onCancel={() => setConfirm(null)} onConfirm={() => doDeleteReport(confirm.report)}
          message={<>{t("patients.deleteReportMsg", { date: confirm.report.report_date || t("patients.unknownDate"), type: confirm.report.report_type || "—" })}</>} />
      )}
    </div>
  );

  function toggleReport(r: Report, state: any, set: any) {
    if (state[r.id]) { const nx = { ...state }; delete nx[r.id]; set(nx); return; }
    api.get<ReportDetail>(`/api/reports/${r.id}`).then((d) => set({ ...state, [r.id]: d })).catch(toastError);
  }
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

/** 姓名相似判定：归一化后完全相同，或长度差 ≤1 且相同字符占比 ≥ 50%（识别/OCR 字形差异）。 */
function nameSimilar(a: string, b: string): boolean {
  const norm = (s: string) => (s || "").replace(/[\s·•.．,，、\-—_()（）男女患者]/g, "").toUpperCase();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  const sx = new Set(x);
  const sy = new Set(y);
  let inter = 0;
  sx.forEach((c) => { if (sy.has(c)) inter += 1; });
  return inter / Math.min(sx.size, sy.size) >= 0.5;
}

function ReportItems({ report, onEditItem }: {
  report: ReportDetail | null;
  onEditItem?: (item: string) => void;
}) {
  const { t } = useI18n();
  if (!report) return <Spinner text="" />;
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>
          <th className="th !bg-transparent">{t("editor.col.item")}</th><th className="th !bg-transparent">{t("editor.col.value")}</th>
          <th className="th !bg-transparent">{t("editor.col.unit")}</th><th className="th !bg-transparent">{t("editor.col.ref")}</th>
          <th className="th !bg-transparent">{t("editor.col.flag")}</th>
          <th className="th !bg-transparent w-10"></th>
        </tr></thead>
        <tbody>
          {report.results.map((it, i) => (
            <tr key={i} className={cn(it.flag === "high" && "bg-red-50/70", it.flag === "low" && "bg-primary-50/60")}>
              <td className="td">{it.item}</td>
              <td className="td font-semibold">{it.value_text}</td>
              <td className="td text-ink-soft">{it.unit}</td>
              <td className="td text-ink-soft">{it.ref_text}</td>
              <td className="td">{it.flag === "normal" ? "—" :
                <Badge tone={it.flag === "high" ? "red" : "blue"}>{it.flag === "high" ? t("editor.flag.high") : t("editor.flag.low")}</Badge>}</td>
              <td className="td text-right">
                {onEditItem && (
                  <button className="p-1 text-slate-300 hover:text-primary-600 cursor-pointer" title={t("patients.editItem")}
                    onClick={() => onEditItem(it.item)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
