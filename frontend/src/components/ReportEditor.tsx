import { useEffect, useRef, useState } from "react";
import { FileSearch, Plus, RotateCcw, Save, Trash2, XCircle } from "lucide-react";
import { api, notify, toastError } from "../api";
import { Badge, Modal, Spinner, cn } from "./ui";
import { useI18n } from "../i18n";
import type { ResultItem, TemplateMeta } from "../types";

const emptyItem = (): ResultItem => ({
  item: "", value_text: "", value_num: null, unit: "",
  ref_text: "", ref_low: null, ref_high: null, flag: "normal",
});

/** 报告编辑器：左侧报告原文/页图，右侧可改患者信息、报告信息与检验行。
 *  mode=report 编辑已入库报告；mode=review 处理待核对记录。 */
export default function ReportEditor({ mode, id, onClose, onSaved }: {
  mode: "report" | "review";
  id: number;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birth, setBirth] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("");
  const [hospital, setHospital] = useState("");
  const [rows, setRows] = useState<ResultItem[]>([]);
  const [rawText, setRawText] = useState("");
  const [filename, setFilename] = useState("");
  const [pages, setPages] = useState(1);
  const [showRaw, setShowRaw] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [selTemplate, setSelTemplate] = useState("");

  useEffect(() => {
    api.get<TemplateMeta[]>("/api/templates").then(setTemplates).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode]);

  async function load() {
    setLoading(true);
    try {
      if (mode === "report") {
        const d = await api.get<any>(`/api/reports/${id}`);
        setName(d.patient?.name || "");
        setGender(d.patient?.gender || "");
        setBirth(d.patient?.birth_date || "");
        setDate(d.report_date || "");
        setType(d.report_type || "");
        setHospital(d.hospital || "");
        setRows((d.results || []).map((x: any) => ({ ...x })));
        setRawText(d.raw_text || "");
        setFilename(d.source_filename || "");
        setPages(1);
      } else {
        const d = await api.get<any>(`/api/review/${id}`);
        const p = d.parsed || {};
        setName(p.patient_name || "");
        setGender(p.gender || "");
        setBirth(p.birth_date || "");
        setDate(p.report_date || "");
        setType(p.report_type || "");
        setHospital(p.hospital || "");
        setRows((p.items || []).map((x: any) => ({ ...x })));
        setRawText(d.raw_text || "");
        setFilename(d.filename || "");
        setPages(d.pages_total || 1);
        setWarnings(p.warnings || []);
        setConfidence(typeof p.confidence === "number" ? p.confidence : null);
        setSelTemplate(p.template_id || "");
      }
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  }

  const updateRow = (i: number, patch: Partial<ResultItem>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    if (!name.trim()) { notify(t("editor.needName"), "error"); return; }
    setSaving(true);
    const body = {
      patient_name: name.trim(), gender: gender || null, birth_date: birth || null,
      report_date: date || null, report_type: type || "检验", hospital: hospital || null,
      items: rows,
    };
    try {
      if (mode === "report") {
        await api.put(`/api/reports/${id}`, body);
        notify(t("editor.saved"), "success");
      } else {
        await api.post(`/api/review/${id}/confirm`, body);
        notify(t("editor.confirmed"), "success");
      }
      onSaved?.();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  }

  async function reparse() {
    try {
      if (mode === "report") {
        await api.post(`/api/reports/${id}/reparse`, {});
        notify(t("editor.reparsed"), "success");
        await load();
      } else {
        if (!selTemplate) { notify(t("editor.pickTemplate"), "error"); return; }
        await api.post(`/api/review/${id}/reparse`, { template_id: selTemplate });
        notify(t("editor.reparsedWithTemplate"), "success");
        await load();
      }
    } catch (e) {
      toastError(e);
    }
  }

  async function skip() {
    try {
      await api.post(`/api/review/${id}/skip`);
      notify(t("editor.skipped"), "info");
      onSaved?.();
      onClose();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Modal width="max-w-6xl" title={`${mode === "report" ? t("editor.editTitle") : t("editor.reviewTitle")} · ${filename}`}
      onClose={onClose}
      footer={
        <>
          {mode === "review" && (
            <button className="btn-ghost" onClick={skip} disabled={saving}>
              <XCircle className="w-3.5 h-3.5" />{t("editor.skip")}
            </button>
          )}
          <button className="btn-ghost" onClick={reparse} disabled={saving || (mode === "review" && !selTemplate)}>
            <RotateCcw className="w-3.5 h-3.5" />{t("editor.reparse")}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Save className="w-3.5 h-3.5" />{saving ? t("editor.saving") : mode === "report" ? t("editor.saveBtn") : t("editor.confirmBtn")}
          </button>
        </>}>

      {loading ? <Spinner /> : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge tone="slate">{t("editor.itemCount", { n: rows.length })}</Badge>
            {confidence !== null && (
              <Badge tone={confidence > 0.7 ? "green" : "amber"}>{t("editor.confidence", { p: Math.round(confidence * 100) })}</Badge>
            )}
            {mode === "review" && (
              <select className="input !w-52 !py-1.5 ml-auto" value={selTemplate}
                onChange={(e) => setSelTemplate(e.target.value)}>
                <option value="">{t("editor.selectTemplate")}</option>
                {templates.map((x) => <option key={x.id} value={x.id}>{x.builtin ? t("editor.builtin") + "·" : t("editor.custom") + "·"}{x.name}</option>)}
              </select>
            )}
          </div>
          {warnings.map((w, i) => (
            <div key={i} className="mb-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-xs px-3 py-2">{w}</div>
          ))}

          <div className="grid lg:grid-cols-[minmax(0,44%),1fr] gap-5">
            <div className="rounded-xl border border-slate-100 overflow-hidden bg-slate-50/50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 text-xs text-ink-soft">
                <span className="flex items-center gap-1.5"><FileSearch className="w-3.5 h-3.5" />{t("editor.rawTitle", { n: pages })}</span>
                <button className="text-primary-700 hover:underline cursor-pointer" onClick={() => setShowRaw(!showRaw)}>
                  {showRaw ? t("editor.viewImage") : t("editor.viewText")}
                </button>
              </div>
              <div className="aspect-[3/4] overflow-auto bg-white">
                {showRaw ? (
                  <pre className="text-xs whitespace-pre-wrap p-3 leading-relaxed">{rawText || "（无原文）"}</pre>
                ) : (
                  <PageImage url={`/api/${mode === "report" ? "reports" : "review"}/${id}/page`} pages={pages} t={t} />
                )}
              </div>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Field label={t("editor.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label={t("editor.gender")}>
                  <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="">{t("editor.unknown")}</option><option>{t("editor.male")}</option><option>{t("editor.female")}</option>
                  </select>
                </Field>
                <Field label={t("editor.birthDate")}><input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} /></Field>
                <Field label={t("editor.reportDate")}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label={t("editor.testItem")}><input className="input" value={type} onChange={(e) => setType(e.target.value)} /></Field>
                <Field label={t("editor.hospital")}><input className="input" value={hospital} onChange={(e) => setHospital(e.target.value)} /></Field>
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink">{t("editor.resultsTitle", { n: rows.length })}</div>
                <button className="btn-ghost !py-1" onClick={() => setRows((r) => [...r, emptyItem()])}>
                  <Plus className="w-3.5 h-3.5" />{t("editor.addRow")}</button>
              </div>
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full">
                  <thead className="sticky top-0"><tr>
                    <th className="th">{t("editor.col.item")}</th><th className="th w-24">{t("editor.col.value")}</th><th className="th w-20">{t("editor.col.unit")}</th>
                    <th className="th w-28">{t("editor.col.ref")}</th><th className="th w-20">{t("editor.col.flag")}</th><th className="th w-8"></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={cn(r.flag === "high" && "bg-red-50/60", r.flag === "low" && "bg-primary-50/50")}>
                        <td className="td"><input className="input !py-1 text-xs" value={r.item} onChange={(e) => updateRow(i, { item: e.target.value })} /></td>
                        <td className="td"><input className="input !py-1 text-xs" value={r.value_text} onChange={(e) => updateRow(i, { value_text: e.target.value })} /></td>
                        <td className="td"><input className="input !py-1 text-xs" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} /></td>
                        <td className="td"><input className="input !py-1 text-xs" value={r.ref_text} onChange={(e) => updateRow(i, { ref_text: e.target.value })} /></td>
                        <td className="td">
                          <select className="input !py-1 text-xs" value={r.flag === "normal" ? "" : r.flag}
                            onChange={(e) => updateRow(i, { flag: (e.target.value || "normal") as any })}>
                            <option value="">{t("editor.flag.auto")}</option><option value="high">{t("editor.flag.highMark")}</option><option value="low">{t("editor.flag.lowMark")}</option>
                          </select>
                        </td>
                        <td className="td text-right">
                          <button className="text-slate-300 hover:text-danger cursor-pointer"
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <div className="text-center text-xs text-ink-faint py-6">{t("editor.noRows")}</div>
                )}
              </div>
              <p className="text-[11px] text-ink-faint mt-2">
                {t("editor.renameHint")}
              </p>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function PageImage({ url, pages, t }: { url: string; pages: number; t: (k: string, v?: Record<string, string | number>) => string }) {
  const [page, setPage] = useState(0);
  const [err, setErr] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [grabbing, setGrabbing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const count = Math.max(1, Math.min(pages || 1, 4));

  // 滚轮缩放（非 passive，才能阻止页面滚动）
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(5, Math.max(0.4, +(z + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clamp = (z: number) => Math.min(5, Math.max(0.4, +z.toFixed(2)));

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
        {Array.from({ length: count }, (_, p) => (
          <button key={p} onClick={() => { setPage(p); setErr(false); }}
            className={cn("text-[11px] px-2 py-1 rounded-md border cursor-pointer",
              p === page ? "bg-primary-700 text-white border-primary-700" : "border-slate-200 hover:border-slate-300")}>
            {t("editor.page", { n: p + 1 })}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <button onClick={() => setZoom((z) => clamp(z - 0.25))}
            className="w-6 h-6 rounded-md border border-slate-200 hover:border-slate-400 cursor-pointer" title="缩小">−</button>
          <span className="w-11 text-center text-ink-soft">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => clamp(z + 0.25))}
            className="w-6 h-6 rounded-md border border-slate-200 hover:border-slate-400 cursor-pointer" title="放大">＋</button>
          <button onClick={() => setZoom(1)}
            className="px-1.5 py-0.5 rounded-md border border-slate-200 hover:border-slate-400 cursor-pointer">{t("editor.fitWidth")}</button>
        </div>
      </div>
      {err ? (
        <div className="text-xs text-ink-faint py-8 text-center">{t("editor.imageError")}</div>
      ) : (
        <div ref={viewport}
          className={cn("overflow-auto rounded-md border border-slate-100 bg-white max-h-[70vh] select-none",
            grabbing ? "cursor-grabbing" : "cursor-grab")}
          onMouseDown={(e) => {
            const el = viewport.current;
            if (!el) return;
            drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
            setGrabbing(true);
          }}
          onMouseMove={(e) => {
            const d = drag.current;
            const el = viewport.current;
            if (!d || !el) return;
            el.scrollLeft = d.l - (e.clientX - d.x);
            el.scrollTop = d.t - (e.clientY - d.y);
          }}
          onMouseUp={() => { drag.current = null; setGrabbing(false); }}
          onMouseLeave={() => { drag.current = null; setGrabbing(false); }}>
          <img src={`${url}/${page}`} alt="报告页" draggable={false}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            className="block" onError={() => setErr(true)} />
        </div>
      )}
      <div className="text-[11px] text-ink-faint mt-1.5">{t("editor.zoomHint")}</div>
    </div>
  );
}
