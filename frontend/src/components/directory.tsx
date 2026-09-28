import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Patient, PatientItemStat } from "../types";

/** 左侧折叠目录与页面共用的状态：患者列表、当前选中的患者、趋势项目。 */
interface DirCtx {
  // 患者目录（两处共用同一份数据）
  patients: Patient[];
  reloadPatients: (kw?: string) => Promise<Patient[]>;

  // 患者库：当前选中的患者
  patientId: number | null;
  selectPatient: (p: Patient | null) => void;
  /** 侧栏「新建患者」按钮要触发的动作，由患者库页面挂载时写入 */
  newPatientRef: { current: (() => void) | null };

  // 趋势分析：当前患者 + 当前检验项目
  trendPatientId: number | null;
  trendItem: string;
  trendItems: PatientItemStat[];
  selectTrendPatient: (p: Patient | null) => void;
  selectTrendItem: (item: string) => void;
  reloadTrendItems: () => Promise<void>;
}

const Ctx = createContext<DirCtx | null>(null);

export function useDirectory(): DirCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return c;
}

export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [trendPatientId, setTrendPatientId] = useState<number | null>(null);
  const [trendItem, setTrendItem] = useState("");
  const [trendItems, setTrendItems] = useState<PatientItemStat[]>([]);
  const newPatientRef = useRef<(() => void) | null>(null);

  const reloadPatients = useCallback(async (kw = "") => {
    const r = await api.get<{ items: Patient[]; total: number }>(
      `/api/patients?q=${encodeURIComponent(kw)}&limit=1000`);
    setPatients(r.items);
    return r.items;
  }, []);

  useEffect(() => { reloadPatients().catch(() => {}); }, [reloadPatients]);

  const reloadTrendItems = useCallback(async () => {
    if (!trendPatientId) { setTrendItems([]); return; }
    try {
      const r = await api.get<PatientItemStat[]>(`/api/stats/items?patient_id=${trendPatientId}`);
      setTrendItems(r);
    } catch {
      setTrendItems([]);
    }
  }, [trendPatientId]);

  useEffect(() => { reloadTrendItems().catch(() => {}); }, [reloadTrendItems]);

  const selectPatient = useCallback((p: Patient | null) => {
    setPatientId(p ? p.id : null);
  }, []);

  const selectTrendPatient = useCallback((p: Patient | null) => {
    setTrendPatientId(p ? p.id : null);
    setTrendItem("");
  }, []);

  const selectTrendItem = useCallback((item: string) => setTrendItem(item), []);

  const value = useMemo<DirCtx>(() => ({
    patients, reloadPatients,
    patientId, selectPatient, newPatientRef,
    trendPatientId, trendItem, trendItems,
    selectTrendPatient, selectTrendItem, reloadTrendItems,
  }), [patients, reloadPatients, patientId, selectPatient,
       trendPatientId, trendItem, trendItems,
       selectTrendPatient, selectTrendItem, reloadTrendItems]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 检验项目排序：有异常的优先，其次按次数、名称。 */
export function sortItems(items: PatientItemStat[]): PatientItemStat[] {
  return [...items].sort((a, b) => {
    const abn = (b.abnormal_cnt > 0 ? 1 : 0) - (a.abnormal_cnt > 0 ? 1 : 0);
    if (abn) return abn;
    if (b.cnt !== a.cnt) return b.cnt - a.cnt;
    return a.item.localeCompare(b.item, "zh");
  });
}
