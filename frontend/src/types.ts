export interface ResultItem {
  id?: number;
  item: string;
  value_text: string;
  value_num: number | null;
  unit: string;
  ref_text: string;
  ref_low: number | null;
  ref_high: number | null;
  /** "auto" 仅存在于表单编辑态：表示交给参考范围自动判断 */
  flag: "high" | "low" | "normal" | "auto" | string;
  /** 该行是否被人工修改过（重解析时不会被直接覆盖） */
  manual?: number;
  manual_json?: string | null;
  /** 1 = 重解析后发现与人工值不同，等待人工确认 */
  confirm_pending?: number;
  /** 本次重新识别得到的值（JSON 字符串），供对比/采用 */
  recognized_json?: string | null;
}

/** 重解析待确认的报告 */
export interface PendingConfirm {
  report_id: number;
  patient_id?: number | null;
  patient_name?: string | null;
  report_date?: string | null;
  report_type?: string | null;
  source_filename?: string;
  n: number;
  items: Array<{
    item: string;
    value_text: string;
    unit?: string | null;
    flag: string;
    manual_json?: string | null;
    recognized_json?: string | null;
  }>;
}

export interface Candidate {
  patient_name?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  report_date?: string | null;
  report_type?: string | null;
  hospital?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  items: ResultItem[];
  confidence?: number;
  warnings?: string[];
}

export interface ImportTask {
  id: number;
  batch_id: number;
  filename: string;
  kind: string;
  status: string;
  error: string | null;
  pages_total: number;
  pages_done: number;
  current_page: number;
  created_at: string;
}

export interface Batch {
  id: number;
  name: string;
  total_files: number;
  status: string;
  created_at: string;
  failed?: number;
  finished?: number;
}

export interface ReviewSummary {
  id: number;
  filename: string;
  template_name?: string | null;
  patient_name?: string | null;
  gender?: string | null;
  report_date?: string | null;
  report_type?: string | null;
  confidence?: number;
  status: string;
  error?: string | null;
  created_at: string;
}

export interface ReviewDetail extends ReviewSummary {
  raw_text?: string;
  parsed: Candidate;
  task?: ImportTask | null;
  pages_total: number;
}

export interface Patient {
  id: number;
  name: string;
  gender?: string | null;
  birth_date?: string | null;
  note?: string | null;
  report_count?: number;
  last_date?: string | null;
}

export interface Report {
  id: number;
  patient_id?: number | null;
  patient_name?: string | null;
  report_date?: string | null;
  report_type?: string | null;
  hospital?: string | null;
  template_name?: string | null;
  source_filename: string;
  result_count?: number;
  created_at: string;
}

export interface PatientItemStat {
  item: string;
  item_norm: string;
  unit: string;
  cnt: number;
  abnormal_cnt: number;
  first_date?: string;
  last_date?: string;
}

export interface TrendPoint {
  report_id: number;
  report_date: string;
  report_type?: string | null;
  hospital?: string | null;
  item: string;
  value_text: string;
  value_num: number | null;
  unit?: string | null;
  ref_text?: string | null;
  ref_low: number | null;
  ref_high: number | null;
  flag: string;
  source_filename?: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  builtin: boolean;
  item_mode: string;
}

export interface Overview {
  patients: number;
  reports: number;
  results: number;
  abnormal: number;
  pending_reviews: number;
  batches: number;
  recent_batches: Batch[];
}

export const flagLabel: Record<string, string> = { high: "偏高", low: "偏低", normal: "正常" };
