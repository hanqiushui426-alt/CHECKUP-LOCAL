import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileUp, RefreshCw, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { api, notify, toastError } from "../api";
import { Badge, Card, Empty, Spinner, StatusTag, useAppRefresh } from "../components/ui";
import { useI18n } from "../i18n";
import type { Batch, ImportTask } from "../types";

interface UploadResp {
  batch: Batch;
  tasks: ImportTask[];
  rejected: { filename: string; error: string }[];
}

const fmtBytes = (b: number) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";

export default function ImportPage() {
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api.get<Batch[]>("/api/import/batches").then((b) => {
      setBatches(b);
      if (b[0]) selectBatch(b[0].id);
    }).finally(() => setLoadingHistory(false));
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换左侧栏目时自动刷新批次与任务
  useAppRefresh(() => {
    api.get<Batch[]>("/api/import/batches").then((b) => {
      setBatches(b);
      const keep = batchId && b.some((x) => x.id === batchId) ? batchId : b[0]?.id;
      if (keep) selectBatch(keep);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  async function selectBatch(id: number) {
    setBatchId(id);
    const all = await api.get<ImportTask[]>(`/api/import/tasks?batch_id=${id}&limit=2000`);
    setTasks(all);
    const busy = all.some((t) => ["queued", "extracting", "ocr", "parsing"].includes(t.status));
    setRunning(busy);
    schedule(busy);
  }

  const pick = (list: FileList | null) => {
    if (!list) return;
    const ok = Array.from(list).filter((f) => /\.(pdf|png|jpe?g|webp|bmp)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok]);
    if (ok.length !== Array.from(list).length) notify(t("import.unsupported"), "info");
  };

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    try {
      const resp = await api.upload<UploadResp>("/api/import", files);
      if (resp.rejected.length) resp.rejected.forEach((r) => notify(`${r.filename}: ${r.error}`, "error"));
      notify(t("import.submitted", { n: resp.tasks.length }), "success");
      setFiles([]);
      await refreshBatches(resp.batch.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function refreshBatches(activeId?: number) {
    const list = await api.get<Batch[]>("/api/import/batches");
    setBatches(list);
    const target = activeId ?? batchId ?? list[0]?.id ?? null;
    if (target) await selectBatch(target);
  }

  function schedule(busy: boolean) {
    if (timer.current) window.clearTimeout(timer.current);
    if (busy) timer.current = window.setTimeout(() => refreshBatches().catch(toastError), 2000);
  }

  async function retry(t: ImportTask) {
    await api.post(`/api/import/tasks/${t.id}/retry`);
    await refreshBatches();
  }
  async function retryFailed() {
    await api.post("/api/import/retry-failed", batchId ? { batch_id: batchId } : {});
    notify(t("import.retried"), "success");
    await refreshBatches();
  }
  async function removeTask(t: ImportTask) {
    await api.del(`/api/import/tasks/${t.id}`);
    await refreshBatches();
  }
  function removeFile(i: number) {
    setFiles((v) => v.filter((_, idx) => idx !== i));
  }

  const progress = tasks.length
    ? Math.round((tasks.filter((t) => t.status === "review" || t.status === "done" || t.status === "error").length / tasks.length) * 100)
    : 0;

  return (
    <>
      <Card
        title={t("import.title")}
        extra={<Badge tone="teal">{t("import.localOnly")}</Badge>}
        className={dragging ? "ring-2 ring-primary-400 bg-primary-50/40" : ""}
      >
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl2 border-2 border-dashed border-slate-200 hover:border-primary-400 transition bg-slate-50/60 p-10 text-center cursor-pointer"
        >
          <input ref={inputRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp"
            onChange={(e) => pick(e.target.files)} />
          <UploadCloud className="w-10 h-10 mx-auto text-primary-500" />
          <p className="mt-3 text-sm font-medium text-ink">{t("import.dropHint")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("import.formatHint")}</p>
        </div>

        {files.length > 0 && (
          <ul className="mt-4 grid sm:grid-cols-2 gap-2 max-h-56 overflow-auto pr-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <FileUp className="w-4 h-4 text-primary-500 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                <span className="text-xs text-ink-faint shrink-0">{fmtBytes(f.size)}</span>
                <button className="text-slate-300 hover:text-danger cursor-pointer" onClick={() => removeFile(i)}>
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" disabled={!files.length || busy} onClick={upload}>
            {busy ? <Spinner text="" /> : <UploadCloud className="w-4 h-4" />}
            {busy ? t("import.uploading") : t("import.startBtn", { n: files.length })}
          </button>
          {files.length > 0 && (
            <button className="btn-ghost" onClick={() => setFiles([])}>{t("import.clearList")}</button>
          )}
          <div className="ml-auto text-xs text-ink-faint">{t("import.autoArchiveHint")}</div>
        </div>
      </Card>

      <Card title={t("import.tasksTitle")}
        extra={
          <div className="flex items-center gap-2">
            <select className="input !w-64 !py-1.5" value={batchId ?? ""} onChange={(e) => refreshBatches(Number(e.target.value))}>
              {batches.length === 0 && <option value="">{t("import.noBatchOption")}</option>}
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}（{b.total_files} {t("import.filesUnit")}）</option>)}
            </select>
            <button className="btn-ghost" onClick={() => refreshBatches()}><RefreshCw className="w-3.5 h-3.5" />{t("import.refresh")}</button>
            {tasks.some((t) => t.status === "error") && (
              <button className="btn-ghost !text-danger" onClick={retryFailed}><RotateCcw className="w-3.5 h-3.5" />{t("import.retryFailed")}</button>
            )}
          </div>
        }>
        {loadingHistory ? (
          <Spinner />
        ) : batchId == null ? (
          <Empty text={t("import.noBatch")} />
        ) : (
          <div>
            {running && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-ink-soft mb-1">
                  <span>{t("import.progress", { p: progress })}</span>
                  <span>{tasks.filter((t) => t.status === "error").length} {t("import.failedUnit")} · {tasks.filter((t) => t.status === "review" || t.status === "done").length} {t("import.archivedUnit")}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-500" style={{ width: progress + "%" }} />
                </div>
              </div>
            )}
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0"><tr>
                  <th className="th">{t("import.col.file")}</th>
                  <th className="th">{t("import.col.type")}</th>
                  <th className="th">{t("import.col.progress")}</th>
                  <th className="th">{t("import.col.status")}</th>
                  <th className="th">{t("import.col.note")}</th>
                  <th className="th text-right">{t("import.col.action")}</th>
                </tr></thead>
                <tbody>
                  {tasks.map((x) => (
                    <tr key={x.id} className="hover:bg-slate-50/60">
                      <td className="td font-medium text-ink max-w-[280px] truncate" title={x.filename}>{x.filename}</td>
                      <td className="td text-xs text-ink-soft">{x.kind === "pdf" ? "PDF" : t("import.image")}</td>
                      <td className="td text-xs text-ink-soft w-32">
                        {x.pages_total ? `${Math.min(x.pages_done, x.pages_total)} / ${x.pages_total} ${t("import.pagesUnit")}` : "—"}
                      </td>
                      <td className="td"><StatusTag status={x.status} /></td>
                      <td className="td text-xs text-ink-faint max-w-[220px] truncate">
                        {x.error && <span className="inline-flex items-center gap-1 text-danger"><AlertCircle className="w-3 h-3" />{x.error}</span>}
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        {(x.status === "error") && (
                          <button className="text-primary-700 hover:text-primary-500 text-xs mr-2 cursor-pointer" onClick={() => retry(x)}>
                            <RotateCcw className="w-3.5 h-3.5 inline" /> {t("import.retry")}
                          </button>
                        )}
                        <button className="text-slate-400 hover:text-danger cursor-pointer" onClick={() => removeTask(x)}>
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tasks.length === 0 && <Empty text={t("import.noTask")} />}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
