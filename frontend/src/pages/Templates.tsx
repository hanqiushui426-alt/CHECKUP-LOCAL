import { useCallback, useEffect, useState } from "react";
import {
  Copy, Download, Eye, FileJson, FlaskConical, LayoutTemplate, Pencil, Plus, Save, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { api, notify, toastError } from "../api";
import { Badge, Card, Empty, Spinner, cn } from "../components/ui";
import { useI18n } from "../i18n";
import type { TemplateMeta } from "../types";

/* ---------------- 类型：UI 表单与后端配置双向映射 ---------------- */
interface ColumnDef { key: string; aliases: string[] }
interface FormItems {
  mode: "table" | "none";
  columns: ColumnDef[];
}
interface TemplateForm {
  name: string; category: string; report_type: string;
  text_contains: string; exclude: string;
  pname: string; pgender: string; pbirth: string; pdate: string;
  items: FormItems;
}

type RawTpl = any;

const blankForm = (): TemplateForm => ({
  name: "", category: "table", report_type: "",
  text_contains: "", exclude: "",
  pname: "", pgender: "", pbirth: "", pdate: "",
  items: { mode: "table", columns: defaultColumns().map((c) => ({ ...c, aliases: [...c.aliases] })) },
});

function defaultColumns(): ColumnDef[] {
  return [
    { key: "item", aliases: ["检验项目", "项目名称", "测定项目", "项目", "指标"] },
    { key: "value", aliases: ["检验结果", "测定结果", "本次结果", "结果"] },
    { key: "unit", aliases: ["单位"] },
    { key: "ref", aliases: ["参考范围", "参考区间", "参考值", "正常范围", "范围", "区间"] },
    { key: "flag", aliases: ["提示", "标志", "标记", "箭头"] },
  ];
}

function toForm(t: RawTpl): TemplateForm {
  const patient = t.patient || {};
  const itemsCfg = t.items || {};
  const columns: ColumnDef[] = Array.isArray(itemsCfg.columns)
    ? itemsCfg.columns.map((c: any) => ({ key: String(c.key || ""), aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [] }))
    : defaultColumns();
  const join = (arr: any) => Array.isArray(arr) ? arr.filter(Boolean).join("，") : "";
  return {
    name: t.name || "", category: t.category || "table", report_type: t.report_type || "",
    text_contains: join((t.match || {}).text_contains), exclude: join((t.match || {}).exclude),
    pname: patient.name_regex || patient.fieldname || "", pgender: patient.gender_regex || "",
    pbirth: patient.birth_regex || patient.fieldbirth || "", pdate: patient.date_regex || patient.fielddate || "",
    items: { mode: itemsCfg.mode === "none" ? "none" : "table", columns },
  };
}

function toPayload(f: TemplateForm, keepId: string): RawTpl {
  const split = (s: string) => s.split(/[，,;；|]/).map((x) => x.trim()).filter(Boolean);
  const payload: RawTpl = {
    name: f.name.trim(), category: f.category,
    match: { text_contains: split(f.text_contains), exclude: split(f.exclude) },
    patient: {
      name_regex: f.pname.trim(), gender_regex: f.pgender.trim(),
      birth_regex: f.pbirth.trim(), date_regex: f.pdate.trim(),
    },
  };
  if (f.report_type.trim()) payload.report_type = f.report_type.trim();
  if (f.items.mode === "none") {
    payload.items = { mode: "none" };
  } else {
    payload.items = {
      mode: "table",
      columns: f.items.columns.filter((c) => c.key.trim() || c.aliases.some((a) => a.trim())),
    };
  }
  if (keepId) payload.id = keepId;
  return payload;
}

export default function TemplatesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"template" | "export">("template");
  return (
    <>
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <TabBtn active={tab === "template"} onClick={() => setTab("template")} icon={<SlidersHorizontal className="w-4 h-4" />} label={t("tpl.tab.templates")} />
        <TabBtn active={tab === "export"} onClick={() => setTab("export")} icon={<Download className="w-4 h-4" />} label={t("tpl.tab.export")} />
      </div>
      {tab === "template" ? <TemplateManager /> : <ExportCenter />}
    </>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn("btn !rounded-lg !border-0 gap-2 px-4 py-2",
      active ? "bg-primary-700 text-white hover:bg-primary-600" : "text-ink-soft hover:bg-slate-50")}>
      {icon}{label}
    </button>
  );
}

/* ================= 模板管理 ================= */
function TemplateManager() {
  const { t } = useI18n();
  const [list, setList] = useState<TemplateMeta[]>([]);
  const [selId, setSelId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<TemplateForm>(blankForm());
  const [raw, setRaw] = useState<RawTpl | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<TemplateMeta[]>("/api/templates");
    setList(r);
    if (!r.some((t) => t.id === selId)) setSelId(r[0]?.id || "");
  }, [selId]);

  useEffect(() => { load().catch(toastError).finally(() => setLoading(false)); }, [load]);

  useEffect(() => {
    if (!selId || isNew) return;
    api.get<RawTpl>(`/api/templates/${selId}`).then((t) => { setRaw(t); setForm(toForm(t)); setEditing(false); }).catch(toastError);
  }, [selId, isNew]);

  const sel = list.find((t) => t.id === selId);
  const set = (patch: Partial<TemplateForm>) => setForm((f) => ({ ...f, ...patch }));

  function startNew() {
    setIsNew(true); setEditing(true); setForm(blankForm());
    setForm((f) => ({ ...f, name: t("tpl.msg.defaultName") }));
  }
  function startEdit() { setEditing(true); }
  function cancelEdit() {
    if (isNew) { setIsNew(false); setSelId(list[0]?.id || ""); }
    else setForm(toForm(raw)); setEditing(false);
  }
  async function save() {
    if (!form.name.trim()) { notify(t("tpl.msg.needName"), "error"); return; }
    if (form.items.mode === "table" && form.items.columns.length === 0) {
      notify(t("tpl.msg.needColumn"), "error"); return;
    }
    setSaving(true);
    try {
      const isBuiltin = list.find((x) => x.id === selId)?.builtin;
      if (isBuiltin && !isNew) {
        const dup = await api.post<RawTpl>("/api/templates", toPayload(form, ""));
        notify(t("tpl.msg.savedCopy"), "success");
        await load(); setSelId(dup.id);
      } else if (isNew) {
        const created = await api.post<RawTpl>("/api/templates", toPayload(form, ""));
        notify(t("tpl.msg.created"), "success");
        await load(); setSelId(created.id);
      } else {
        await api.put(`/api/templates/${selId}`, toPayload(form, selId));
        notify(t("tpl.msg.saved"), "success");
      }
      setIsNew(false); setEditing(false);
    } catch (e) { toastError(e); } finally { setSaving(false); }
  }
  async function remove() {
    if (!sel || !selId) return;
    if (!window.confirm(t("tpl.msg.confirmDelete", { name: sel.name }))) return;
    try {
      await api.del(`/api/templates/${selId}`);
      notify(t("tpl.msg.deleted"), "info"); await load();
    } catch (e) { toastError(e); }
  }

  return (
    <div className="grid lg:grid-cols-[300px,1fr] gap-5 items-start">
      {/* 左侧：模板列表 */}
      <Card title={t("tpl.list.title", { n: list.length })} className="lg:sticky lg:top-20 flex flex-col max-h-[calc(100vh-150px)]">
        <div className="space-y-2 pr-1 overflow-y-auto flex-1 -mr-1">
          {list.map((x) => (
            <button key={x.id} onClick={() => { setSelId(x.id); setIsNew(false); }}
              className={cn("w-full text-left rounded-xl border px-3.5 py-2.5 transition cursor-pointer",
                selId === x.id ? "border-primary-400 bg-primary-50/70 shadow-sm" : "border-slate-100 hover:border-slate-200 bg-white")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink text-sm truncate">{x.name}</span>
                {x.builtin ? <Badge tone="teal">{t("tpl.builtin")}</Badge> : <Badge tone="blue">{t("tpl.custom")}</Badge>}
              </div>
              <div className="text-[11px] text-ink-faint mt-1 flex items-center gap-1.5">
                <span>{x.category ? t(`tpl.cat.${x.category}`) : ""}</span>
                <span>·</span><span>{x.item_mode === "none" ? t("tpl.mode.text") : t("tpl.mode.table")}</span>
              </div>
            </button>
          ))}
          {!loading && list.length === 0 && <Empty text={t("tpl.list.empty")} />}
        </div>
        <button className="btn-primary w-full mt-3" onClick={startNew}><Plus className="w-4 h-4" />{t("tpl.new")}</button>
      </Card>

      {/* 右侧：详情 / 编辑 / 调试 */}
      {!sel && !isNew ? (
        <Card><Empty text={t("tpl.empty.select")} /></Card>
      ) : (
        <Card
          title={isNew ? t("tpl.detail.newTitle") : (sel?.name || t("tpl.detail.title"))}
          extra={
            <div className="flex gap-2">
              <Badge tone={sel?.builtin ? "teal" : "blue"}>{sel?.builtin ? t("tpl.builtinFull") : t("tpl.customFull")}</Badge>
              {!editing && (
                <>
                  <button className="btn-ghost !py-1.5" onClick={startEdit}><Pencil className="w-3.5 h-3.5" />{t("tpl.edit")}</button>
                  {!sel?.builtin && <button className="btn-danger !py-1.5" onClick={remove}><Trash2 className="w-3.5 h-3.5" />{t("common.delete")}</button>}
                </>
              )}
            </div>
          }>
          {editing ? (
            <EditForm form={form} set={set} isNew={isNew} isBuiltin={!!sel?.builtin && !isNew} />
          ) : (
            <TemplateView form={form} />
          )}

          {!editing && sel && <DebugPreview templateId={sel.id} />}

          {editing && (
            <div className="mt-5 flex items-center gap-3">
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving ? <Spinner text="" /> : <Save className="w-4 h-4" />}{t("tpl.save")}
              </button>
              <button className="btn-ghost" onClick={cancelEdit}>{t("common.cancel")}</button>
              {isBuiltinHint(sel?.builtin, t)}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function isBuiltinHint(builtin: boolean | undefined, t: (k: string) => string) {
  if (!builtin) return null;
  return <span className="text-xs text-ink-faint">{t("tpl.builtinHint")}</span>;
}

function EditForm({ form, set, isNew, isBuiltin }: { form: TemplateForm; set: (p: Partial<TemplateForm>) => void; isNew: boolean; isBuiltin: boolean }) {
  const { t } = useI18n();
  const setCol = (i: number, patch: Partial<ColumnDef>) => {
    const columns = form.items.columns.map((c, j) => (j === i ? { ...c, ...patch } : c));
    set({ items: { ...form.items, columns } });
  };
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t("tpl.form.name")}><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t("tpl.form.category")}>
          <select className="input" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="table">{t("tpl.cat.table")}</option>
            <option value="text">{t("tpl.cat.text")}</option>
            <option value="blood">{t("tpl.cat.blood")}</option>
            <option value="urine">{t("tpl.cat.urine")}</option>
            <option value="bio">{t("tpl.cat.bio")}</option>
          </select>
        </Field>
        <Field label={t("tpl.form.reportType")}>
          <input className="input" value={form.report_type} placeholder={t("tpl.form.reportTypePh")} onChange={(e) => set({ report_type: e.target.value })} />
        </Field>
      </div>

      <div>
        <div className="label">{t("tpl.form.extractMode")}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <ModeCard active={form.items.mode === "table"} onClick={() => set({ items: { ...form.items, mode: "table" } })}
            title={t("tpl.form.modeTable")} desc={t("tpl.form.modeTableDesc")} />
          <ModeCard active={form.items.mode === "none"} onClick={() => set({ items: { ...form.items, mode: "none" } })}
            title={t("tpl.form.modeNone")} desc={t("tpl.form.modeNoneDesc")} />
        </div>
      </div>

      {form.items.mode === "table" && (
        <div className="rounded-xl border border-slate-100 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="label !mb-0">{t("tpl.form.columns")}</span>
            <button className="btn-ghost !py-1 text-xs" onClick={() => set({ items: { ...form.items, columns: [...form.items.columns, { key: "", aliases: [] }] } })}>
              <Plus className="w-3 h-3" />{t("tpl.form.addColumn")}
            </button>
          </div>
          <div className="space-y-2">
            {form.items.columns.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select className="input !w-32" value={c.key} onChange={(e) => setCol(i, { key: e.target.value })}>
                  <option value="">{t("tpl.form.selectMeaning")}</option>
                  <option value="item">{t("tpl.form.col.item")}</option>
                  <option value="value">{t("tpl.form.col.value")}</option>
                  <option value="unit">{t("tpl.form.col.unit")}</option>
                  <option value="ref">{t("tpl.form.col.ref")}</option>
                  <option value="flag">{t("tpl.form.col.flag")}</option>
                </select>
                <input className="input flex-1" placeholder={t("tpl.form.aliasesPh")}
                  value={c.aliases.join("，")} onChange={(e) => setCol(i, { aliases: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean) })} />
                <button className="text-slate-300 hover:text-danger cursor-pointer shrink-0" onClick={() => {
                  const columns = form.items.columns.filter((_, j) => j !== i);
                  set({ items: { ...form.items, columns } });
                }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          {form.items.columns.length === 0 && <p className="text-xs text-ink-faint text-center py-3">{t("tpl.form.noColumns")}</p>}
        </div>
      )}

      <div>
        <div className="label mb-2">{t("tpl.form.patientRegex")}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t("tpl.form.nameRegex")}><input className="input font-mono text-xs" placeholder="姓名[:：]\s*([\u4e00-\u9fa5·]{2,6})" value={form.pname} onChange={(e) => set({ pname: e.target.value })} /></Field>
          <Field label={t("tpl.form.genderRegex")}><input className="input font-mono text-xs" placeholder="性别[:：]\s*([男女])" value={form.pgender} onChange={(e) => set({ pgender: e.target.value })} /></Field>
          <Field label={t("tpl.form.birthRegex")}><input className="input font-mono text-xs" placeholder="出生日期[:：]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})" value={form.pbirth} onChange={(e) => set({ pbirth: e.target.value })} /></Field>
          <Field label={t("tpl.form.dateRegex")}><input className="input font-mono text-xs" placeholder="(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})" value={form.pdate} onChange={(e) => set({ pdate: e.target.value })} /></Field>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t("tpl.form.contains")}><input className="input" placeholder={t("tpl.form.containsPh")} value={form.text_contains} onChange={(e) => set({ text_contains: e.target.value })} /></Field>
        <Field label={t("tpl.form.exclude")}><input className="input" placeholder={t("tpl.form.excludePh")} value={form.exclude} onChange={(e) => set({ exclude: e.target.value })} /></Field>
      </div>

      {!isNew && isBuiltin && <div className="rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-xs px-3 py-2">{t("tpl.builtinWarn")}</div>}
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-xl border p-3.5 text-left transition cursor-pointer",
        active ? "border-primary-500 bg-primary-50/70 ring-2 ring-primary-100" : "border-slate-200 bg-white hover:border-slate-300")}>
      <div className="text-sm font-medium text-ink flex items-center gap-2">
        <span className={cn("w-3 h-3 rounded-full border-2", active ? "border-primary-600 bg-primary-500" : "border-slate-300")} />
        {title}
      </div>
      <div className="text-xs text-ink-soft mt-1 pl-5">{desc}</div>
    </button>
  );
}

function TemplateView({ form }: { form: TemplateForm }) {
  const { t } = useI18n();
  return (
    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
      <KV k={t("tpl.view.reportType")} v={form.report_type || t("tpl.view.auto")} />
      <KV k={t("tpl.view.mode")} v={form.items.mode === "none" ? t("tpl.view.modeNoneFull") : t("tpl.view.modeTableFull", { n: form.items.columns.length })} />
      <KV k={t("tpl.view.contains")} v={form.text_contains || t("tpl.view.fallback")} />
      <KV k={t("tpl.view.exclude")} v={form.exclude || "—"} />
      <KV k={t("tpl.view.nameRegex")} v={form.pname || t("tpl.view.defaultRule")} mono />
      <KV k={t("tpl.view.genderRegex")} v={form.pgender || t("tpl.view.defaultRule")} mono />
      <KV k={t("tpl.view.birthRegex")} v={form.pbirth || t("tpl.view.defaultRule")} mono />
      <KV k={t("tpl.view.dateRegex")} v={form.pdate || t("tpl.view.defaultRule")} mono />
      {form.items.mode === "table" && (
        <div className="sm:col-span-2">
          <span className="label">{t("tpl.view.aliases")}</span>
          <div className="flex flex-wrap gap-1.5">
            {form.items.columns.map((c, i) => (
              <Badge key={i} tone="slate">{c.key || "?"}：{c.aliases.join(" / ") || t("tpl.view.emptyAlias")}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span className="label">{k}</span>
      <div className={cn("rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-ink-soft break-all",
        mono && "font-mono text-xs")}>{v}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

/* ================= 用样例调试 ================= */
function DebugPreview({ templateId }: { templateId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RawTpl | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/templates/debug-file?template_id=${encodeURIComponent(templateId)}`, { method: "POST", body: fd });
      const body = await r.json();
      if (!r.ok) { setError(body?.detail || t("tpl.debug.failed")); return; }
      setResult(body);
    } catch (e: any) {
      setError(e?.message || t("tpl.debug.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <button className="btn-ghost" onClick={() => setOpen(!open)}>
        <FlaskConical className="w-3.5 h-3.5 text-primary-600" />{t("tpl.debug.title")}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="text-xs"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setError(""); }} />
            <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={!file || busy} onClick={run}>
              <Eye className="w-3.5 h-3.5" />{busy ? t("tpl.debug.running") : t("tpl.debug.run")}
            </button>
            <span className="text-xs text-ink-faint">{t("tpl.debug.tip")}</span>
          </div>
          {error && <div className="mt-3 text-xs text-danger">{error}</div>}
          {result && <DebugResult result={result} />}
        </div>
      )}
    </div>
  );
}

function DebugResult({ result }: { result: RawTpl }) {
  const { t } = useI18n();
  const items = result.items || [];
  return (
    <div className="mt-3 rounded-lg bg-white border border-slate-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge tone={result.confidence > 0.7 ? "green" : "amber"}>{t("tpl.debug.confidence")} {Math.round((result.confidence || 0) * 100)}%</Badge>
        <Badge tone="teal">{result.template_name || t("tpl.debug.defaultTpl")}</Badge>
        <span className="text-xs text-ink-soft">{t("tpl.debug.patient")}{result.patient_name || t("tpl.debug.notRecognized")} · {result.gender || "—"} · {t("tpl.debug.date")}{result.report_date || "—"}</span>
      </div>
      {(result.warnings || []).map((w: string, i: number) => (
        <div key={i} className="mb-2 text-xs text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5">{w}</div>
      ))}
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th">{t("tpl.debug.col.item")}</th><th className="th">{t("tpl.debug.col.value")}</th><th className="th">{t("tpl.debug.col.num")}</th>
              <th className="th">{t("tpl.debug.col.unit")}</th><th className="th">{t("tpl.debug.col.ref")}</th><th className="th">{t("tpl.debug.col.flag")}</th>
            </tr></thead>
            <tbody>
              {items.map((it: any, i: number) => (
                <tr key={i} className={cn(it.flag === "high" && "bg-red-50/60", it.flag === "low" && "bg-primary-50/50")}>
                  <td className="td font-medium">{it.item}</td>
                  <td className="td font-semibold">{it.value_text}</td>
                  <td className="td text-ink-soft">{it.value_num ?? "—"}</td>
                  <td className="td">{it.unit}</td>
                  <td className="td text-ink-soft">{it.ref_text || "—"}</td>
                  <td className="td">{it.flag === "normal" ? "—" :
                    <Badge tone={it.flag === "high" ? "red" : "blue"}>{it.flag === "high" ? t("tpl.flag.high") : t("tpl.flag.low")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-ink-faint py-4 text-center">{t("tpl.debug.noItems")}</div>
      )}
    </div>
  );
}

/* ================= 数据导出中心 ================= */
function ExportCenter() {
  const { t, lang } = useI18n();
  const [patients, setPatients] = useState<Array<{ id: number; name: string; report_count?: number }>>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [pid, setPid] = useState<number | "">("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ items: any[] }>("/api/patients?limit=1000"),
      api.get<string[]>("/api/stats/types"),
    ]).then(([p, t]) => { setPatients(p.items); setTypes(t); })
      .catch(toastError)
      .finally(() => setLoading(false));
  }, []);

  const openExport = (url: string) => window.open(url, "_blank");
  const qs = () => {
    const parts = new URLSearchParams();
    if (pid !== "") parts.set("patient_id", String(pid));
    if (type) parts.set("report_type", type);
    parts.set("lang", lang);
    return "?" + parts.toString();
  };

  if (loading) return <Spinner text={t("tpl.export.loading")} />;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr),340px] gap-5 items-start">
      <Card title={t("tpl.export.title")} extra={<Badge tone="teal"><FileJson className="w-3 h-3 mr-1" />{t("tpl.export.xlsx")}</Badge>}>
        <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
          <p dangerouslySetInnerHTML={{ __html: t("tpl.export.intro") }} />
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="font-semibold text-ink flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-primary-600" />{t("tpl.export.detailCard")}</div>
              <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
                <li>{t("tpl.export.detailL1")}</li>
                <li>{t("tpl.export.detailL2")}</li>
                <li>{t("tpl.export.detailL3")}</li>
              </ul>
            </div>
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="font-semibold text-ink flex items-center gap-2"><Copy className="w-4 h-4 text-primary-600" />{t("tpl.export.trendCard")}</div>
              <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
                <li>{t("tpl.export.trendL1")}</li>
                <li>{t("tpl.export.trendL2")}</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>

      <Card title={t("tpl.export.scope")}>
        <div className="space-y-3">
          <Field label={t("tpl.export.patient")}>
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("tpl.export.allPatients")}</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.report_count ?? 0} {t("tpl.export.reportCount")}）</option>)}
            </select>
          </Field>
          <Field label={t("tpl.export.type")}>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t("tpl.export.allTypes")}</option>
              {types.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <button className="btn-primary w-full" onClick={() => openExport("/api/export/results.xlsx" + qs())}>
            <Download className="w-4 h-4" />{t("tpl.export.button")}
          </button>
          <p className="text-[11px] text-ink-faint leading-relaxed">
            {t("tpl.export.hint")}
          </p>
        </div>
      </Card>
    </div>
  );
}
