import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, FilePlus2, Merge, Pencil, RotateCcw, Trash2, UploadCloud, UserPlus,
} from "lucide-react";
import { api, toastError } from "../api";
import { Badge, Card, Empty, Spinner, Stat, useAppRefresh } from "../components/ui";
import { useI18n } from "../i18n";
import type { Overview } from "../types";

const KIND_META: Record<string, { labelKey: string; tone: string; icon: any }> = {
  import: { labelKey: "activity.import", tone: "blue", icon: UploadCloud },
  archive: { labelKey: "activity.archive", tone: "teal", icon: FilePlus2 },
  edit: { labelKey: "activity.edit", tone: "amber", icon: Pencil },
  delete: { labelKey: "activity.delete", tone: "red", icon: Trash2 },
  merge: { labelKey: "activity.merge", tone: "blue", icon: Merge },
  patient: { labelKey: "activity.patient", tone: "teal", icon: UserPlus },
  reparse: { labelKey: "activity.reparse", tone: "slate", icon: RotateCcw },
};

export default function Dashboard() {
  const { t } = useI18n();
  const [ov, setOv] = useState<Overview | null>(null);
  const [abnormal, setAbnormal] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const nav = useNavigate();

  async function loadAll() {
    api.get<Overview>("/api/stats/overview").then(setOv).catch(toastError);
    api.get<any[]>("/api/stats/abnormal?limit=8").then(setAbnormal).catch(() => {});
    api.get<any[]>("/api/stats/activity?limit=30").then(setActivities).catch(() => {});
  }

  useEffect(() => { loadAll(); }, []);
  useAppRefresh(loadAll);

  if (!ov) return <Spinner text="正在加载工作台…" />;

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Link to="/patients" className="cursor-pointer block">
          <Stat label={t("dash.patients")} value={ov.patients} tone="teal" hint={t("dash.patientsHint")} />
        </Link>
        <Link to="/patients" className="cursor-pointer block">
          <Stat label={t("dash.reports")} value={ov.reports} tone="blue"
            hint={t("dash.reportsHint", { n: ov.results })} />
        </Link>
        <Link to="/patients" className="cursor-pointer block">
          <Stat label={t("dash.pending")} value={ov.pending_reviews} tone="amber"
            hint={ov.pending_reviews ? t("dash.pendingHint") : t("dash.pendingDone")} />
        </Link>
        <Link to="/patients" className="cursor-pointer block">
          <Stat label={t("dash.abnormal")} value={ov.abnormal} tone="red" hint={t("dash.abnormalHint")} />
        </Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card title={t("dash.activity")} className="lg:col-span-2" extra={
          <Link to="/import" className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1">
            {t("dash.goImport")} <ArrowRight className="w-3 h-3" />
          </Link>
        }>
          {activities.length === 0 ? (
            <Empty text={t("dash.activityEmpty")} />
          ) : (
            <ul className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {activities.map((a) => {
                const m = KIND_META[a.kind] || { labelKey: a.kind, label: "", tone: "slate", icon: FilePlus2 };
                const Icon = m.icon;
                const text = a.key ? t(a.key, a.vars || {}) : (a.raw || "");
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <span className="w-7 h-7 rounded-lg bg-slate-50 grid place-items-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-primary-600" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate" title={text}>{text}</div>
                      <div className="text-xs text-ink-faint">{a.ts}</div>
                    </div>
                    <Badge tone={m.tone}>{t(m.labelKey)}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={t("dash.abnormalList")} extra={
          <button className="btn-primary !py-1 !px-3 text-xs" onClick={() => nav("/import")}>
            <UploadCloud className="w-3.5 h-3.5" /> {t("dash.batchImport")}
          </button>
        }>
          {abnormal.length === 0 ? (
            <Empty text={t("dash.abnormalEmpty")} />
          ) : (
            <ul className="space-y-2.5">
              {abnormal.map((a, i) => (
                <li key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">
                      <span className="font-medium text-ink">{a.patient_name}</span>
                      <span className="text-ink-soft"> · {a.item}</span>
                    </div>
                    <div className="text-xs text-ink-faint">{a.report_date}</div>
                  </div>
                  <Badge tone={a.flag === "high" ? "red" : "blue"}>
                    {a.flag === "high" ? t("dash.high") : t("dash.low")} {a.value_text}{a.unit ? " " + a.unit : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
