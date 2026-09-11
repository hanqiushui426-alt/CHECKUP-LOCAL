import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity, FileText, Languages, UploadCloud, Users, LineChart, ShieldCheck,
} from "lucide-react";
import { cn } from "./ui";
import { LANGS, useI18n, type Lang } from "../i18n";

const NAV = [
  { to: "/", key: "nav.dashboard", icon: Activity, end: true },
  { to: "/import", key: "nav.import", icon: UploadCloud },
  { to: "/patients", key: "nav.patients", icon: Users },
  { to: "/trends", key: "nav.trends", icon: LineChart },
];

export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const loc = useLocation();
  const nav = NAV.map((n) => ({ ...n, label: t(n.key) }));
  const activeLabel = nav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label;

  return (
    <div className="flex h-full min-h-screen">
      <aside className="fixed left-0 top-0 h-full w-60 bg-white/90 backdrop-blur border-r border-slate-100 flex flex-col z-20">
        <div className="px-5 h-16 flex items-center gap-2.5 border-b border-slate-100">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white grid place-items-center shadow-card">
            <Activity className="w-4.5 h-4.5" />
          </span>
          <div className="leading-tight">
            <div className="font-bold text-[15px] text-ink">{t("layout.brand")}</div>
            <div className="text-[10px] text-primary-700/80 tracking-wider">CHECKUP · LOCAL</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              onClick={() => window.dispatchEvent(new CustomEvent("app:refresh"))}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                isActive
                  ? "bg-primary-50 text-primary-800 font-medium shadow-sm"
                  : "text-ink-soft hover:bg-slate-50 hover:text-ink")}>
              <n.icon className="w-4 h-4" />
              {n.label}
            </NavLink>
          ))}
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

      <div className="flex-1 ml-60 min-w-0 flex flex-col">
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
