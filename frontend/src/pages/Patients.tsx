import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Pencil, RefreshCw, Trash2, Users } from "lucide-react";
import { api, notify, toastError } from "../api";
import { Badge, Card, ConfirmDialog, Empty, Modal, Spinner, cn, useAppRefresh } from "../components/ui";
import ReportEditor from "../components/ReportEditor";
import { useDirectory } from "../components/directory";
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
  const dir = useDirectory();
  const [draft, setDraft] = useState<Patient | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [dups, setDups] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
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

  // 侧栏「新建患者」按钮 → 打开弹窗
  useEffect(() => {
    dir.newPatientRef.current = () => setCreating({ name: "", gender: "", birth_date: "", note: "" });
    return () => { dir.newPatientRef.current = null; };
  }, [dir]);

  const loadPending = useCallback(async () => {
    const r = await api.get<{ items: ReviewSummary[] }>("/api/review?status=pending&limit=200");
    setPending(r.items);
  }, []);

  const loadPendingConfirm = useCallback(async () => {
    const r = await api.get<{ items: PendingConfirm[] }>("/api/reports/pending-confirm");
    setPendingConfirm(r.items);
  }, []);

  // 当前选中的患者（由左侧目录驱动）
  const sel = dir.patientId ? (dir.patients.find((p) => p.id === dir.patientId) || null) : null;

  useEffect(() => {
    const p = dir.patientId ? (dir.patients.find((x) => x.id === dir.patientId) || null) : null;
    setOpenReports({});
    setDraft(p ? { ...p } : null);
    setDups(p ? dir.patients.filter((d) => d.id !== p.id && nameSimilar(d.name, p.name)) : []);
    if (!p) { setReports([]); return; }
    setLoading(true);
    api.get<{ items: Report[] }>(`/api/patients/${p.id}/reports?limit=500`)
      .then((r) => setReports(r.items))
      .catch(toastError)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir.patientId]);

  useEffect(() => {
    loadPending().catch(() => {});
    loadPendingConfirm().catch(() => {});
  }, [loadPending, loadPendingConfirm]);

  useAppRefresh(() => {
    dir.reloadPatients().catch(() => {});
    loadPending().catch(() => {});
    loadPendingConfirm().catch(() => {});
  });

  // 从「趋势分析」跳转进来：/patients?patient=1&report=2&item=白细胞计数
  useEffect(() => {
    if (jumpHandled.current || !dir.patients.length) return;
    const pid = Number(sp.get("patient") || 0);
    if (!pid) return;
    jumpHandled.current = true;
    const rid = Number(sp.get("report") || 0);
    const focus = sp.get("item") || undefined;
    const next = new URLSearchParams(sp);
    ["patient", "report", "item"].forEach((k) => next.delete(k));
    setSp(next, { replace: true });
    const p = dir.patients.find((x) => x.id === pid);
    if (p) dir.selectPatient(p);
    if (rid) setEditor({ mode: "report", id: rid, focusItem: focus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir.patients, sp, setSp]);

  async function onEditorSaved() {
    setEditor(null);
    await loadPending().catch(() => {});
    await loadPendingConfirm().catch(() => {});
    await dir.reloadPatients().catch(() => {});
    if (dir.patientId) {
      const rp = await api.get<{ items: Report[] }>(`/api/patients/${dir.patientId}/reports?limit=500`)
        .catch(() => null);
      if (rp) setReports(rp.items);
    }
  }

  async function savePatient() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.put(`/api/patients/${draft.id}`, {
        name: draft.name, gender: draft.gender || "", birth_date: draft.birth_date || "",
        note: draft.note || "",
      });
      notify(t("patients.savedProfile"), "success");
      await dir.reloadPatients();
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
      await dir.reloadPatients();
      dir.selectPatient(p);
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
      setConfirm(null);
      dir.selectPatient(null);
      setReports([]);
      await dir.reloadPatients();
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
      if (dir.patientId) {
        const rp = await api.get<{ items: Report[] }>(`/api/patients/${dir.patientId}/reports?limit=500`);
        setReports(rp.items);
      }
      await dir.reloadPatients();
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
      if (dir.patientId) {
        const rp = await api.get<{ items: Report[] }>(`/api/patients/${dir.patientId}/reports?limit=500`);
        setReports(rp.items);
      }
      await dir.reloadPatients();
      await loadPendingConfirm().catch(() => {});
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
      dir.selectPatient(null);
      await dir.reloadPatients();
      await loadPendingConfirm().catch(() => {});
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
      await dir.reloadPatients();
      setDups([]);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function toggleReport(r: Report) {
    if (openReports[r.id]) {
      const nx = { ...openReports };
      delete nx[r.id];
      setOpenReports(nx);
      return;
    }
    api.get<ReportDetail>(`/api/reports/${r.id}`)
      .then((d) => setOpenReports((prev) => ({ ...prev, [r.id]: d })))
      .catch(toastError);
  }

  async function openReportForConfirm(pid: number | null | undefined, rid: number, item?: string) {
    const p = dir.patients.find((x) => x.id === pid);
    if (p) dir.selectPatient(p);
    setEditor({ mode: "report", id: rid, focusItem: item });
  }

  return (
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

      {!sel || !draft ? (
        <Card><Empty text={t("patients.selectHint")} /></Card>
      ) : (
        <>
          <Card title={t("patients.profile")} extra={
            <div className="flex gap-2">
              <button className="btn-danger !py-1.5" onClick={() => setConfirm({ kind: "delete-patient" })}>
                <Trash2 className="w-3.5 h-3.5" />{t("common.delete")}</button>
            </div>}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <EditField label={t("patients.name")}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></EditField>
              <EditField label={t("patients.gender")}>
                <select className="input" value={draft.gender || ""} onChange={(e) => setDraft({ ...draft, gender: e.target.value || null })}>
                  <option value="">{t("patients.unknown")}</option><option>{t("patients.male")}</option><option>{t("patients.female")}</option>
                </select>
              </EditField>
              <EditField label={t("patients.birthDate")}><input className="input" type="date" value={draft.birth_date || ""} onChange={(e) => setDraft({ ...draft, birth_date: e.target.value || null })} /></EditField>
              <EditField label={t("patients.note")}><input className="input" value={draft.note || ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></EditField>
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
                        onClick={() => toggleReport(r)}>
                        <FileText className="w-4 h-4 text-primary-500 shrink-0" />
                        <span className="font-medium text-ink text-sm">{r.report_date || t("patients.unknownDate")} · {r.report_type || "检验"}</span>
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
