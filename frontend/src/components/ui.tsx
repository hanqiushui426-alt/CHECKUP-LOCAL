import { useEffect, useRef, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import { useI18n } from "../i18n";

export function cn(...parts: Array<string | false | null | undefined>) {
  return twMerge(parts.filter(Boolean).join(" "));
}

// ---------- 通用小组件 ----------
export function Card({ title, extra, children, className }: {
  title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("card p-5", className)}>
      {(title || extra) && (
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <div className="flex items-center gap-2">{extra}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "teal" }: {
  label: string; value: ReactNode; hint?: string; tone?: "teal" | "red" | "amber" | "blue";
}) {
  const dot = { teal: "bg-primary-500", red: "bg-danger", amber: "bg-warn", blue: "bg-info" }[tone];
  return (
    <div className="card p-4 flex items-center gap-3.5">
      <span className={cn("w-1.5 h-9 rounded-full", dot)} />
      <div className="min-w-0">
        <div className="text-2xl font-bold text-ink leading-7">{value}</div>
        <div className="text-xs text-ink-soft mt-0.5 truncate">{hint || label}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    teal: "bg-primary-50 text-primary-700",
    green: "bg-green-50 text-good",
    red: "bg-red-50 text-danger",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-info",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", map[tone] || map.slate)}>
      {children}
    </span>
  );
}

export function Spinner({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-ink-soft text-sm">
      <Loader2 className="animate-spin w-4 h-4 text-primary-600" /> {text || t("common.loading")}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="py-14 text-center text-ink-faint text-sm border border-dashed border-slate-200 rounded-xl">
      {text}
    </div>
  );
}

export function StatusTag({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, string> = {
    queued: "status.queued",
    extracting: "status.extracting",
    ocr: "status.ocr",
    parsing: "status.parsing",
    review: "status.review",
    done: "status.done",
    error: "status.error",
  };
  const tone: Record<string, string> = {
    queued: "slate", extracting: "blue", ocr: "blue", parsing: "blue",
    review: "amber", done: "green", error: "red",
  };
  return <Badge tone={tone[status] || "slate"}>{map[status] ? t(map[status]) : status}</Badge>;
}

// ---------- 切换栏目自动刷新 ----------
export function useAppRefresh(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, []);
}

// ---------- 可搜索下拉 ----------
export function SearchSelect({ value, options, onChange, placeholder, disabled, width = "w-full" }: {
  /** 可搜索下拉：点击展开，输入关键词过滤，选择后立即收起 */
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const kw = q.trim().toLowerCase();
  const filtered = kw ? options.filter((o) => o.label.toLowerCase().includes(kw)) : options;
  const current = options.find((o) => o.value === value);
  return (
    <div className={cn("relative", width)} ref={box}>
      <button type="button" disabled={disabled}
        className="input text-left flex items-center justify-between gap-2 cursor-pointer"
        onClick={() => { setOpen(!open); setQ(""); }}>
        <span className={cn("truncate text-sm", !current && "text-slate-400")}>
          {current?.label || placeholder || t("ui.pleaseSelect")}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-card">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
              <input autoFocus className="input !py-1.5 !pl-8 text-sm" placeholder={t("ui.filterPlaceholder")}
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="text-xs text-ink-faint text-center py-4">{t("ui.noMatch")}</div>
            )}
            {filtered.map((o) => (
              <button key={o.value} type="button"
                className={cn("w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer",
                  o.value === value && "bg-primary-50 text-primary-800")}
                onMouseDown={(e) => {
                  // 在 mousedown 阶段即完成选择并收起，避免依赖后续 click 事件
                  e.preventDefault();
                  onChange(o.value);
                  setOpen(false);
                }}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 弹窗 ----------
export function Modal({ title, children, footer, onClose, width = "max-w-lg" }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: string;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={cn("relative w-full rounded-2xl bg-white shadow-card p-5", width)}>
        <header className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500 cursor-pointer" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </header>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmText = "确认", danger, busy,
                                children, onCancel, onConfirm }: {
  title: string; message: ReactNode; confirmText?: string; danger?: boolean; busy?: boolean;
  children?: ReactNode; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
        <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "处理中…" : confirmText}
        </button>
      </>}>
      <div className="text-sm text-ink-soft leading-6">{message}</div>
      {children && <div className="mt-3">{children}</div>}
    </Modal>
  );
}

// ---------- Toast ----------
interface ToastItem { id: number; message: string; type: string }
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const id = Date.now() + Math.random();
      setItems((v) => [...v, { id, message: detail.message || "", type: detail.type || "info" }]);
      setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 3600);
    };
    window.addEventListener("app:toast", on);
    return () => window.removeEventListener("app:toast", on);
  }, []);
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {items.map((t) => (
        <div key={t.id}
          className={cn("rounded-lg px-3.5 py-2.5 text-sm shadow-card border flex items-start justify-between gap-2 animate-[fadeIn_.2s]",
            t.type === "success" && "bg-white border-green-200 text-green-700",
            t.type === "error" && "bg-white border-red-200 text-danger",
            t.type !== "error" && t.type !== "success" && "bg-white border-slate-200 text-ink")}>
          <span className="min-w-0">{t.message}</span>
          <button className="text-slate-300 hover:text-slate-500 cursor-pointer" onClick={() =>
            setItems((v) => v.filter((x) => x.id !== t.id))} aria-label="关闭">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
