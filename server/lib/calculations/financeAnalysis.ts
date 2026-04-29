// Pure helpers for the Finance Analysis pages.
// No DB, no IO — all functions are deterministic and unit-testable.

export type AgingBucketKey = "not_due" | "0_30" | "31_60" | "61_90" | "over_90";

export const AGING_BUCKET_KEYS: AgingBucketKey[] = [
  "not_due",
  "0_30",
  "31_60",
  "61_90",
  "over_90",
];

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  not_due: "Not yet due",
  "0_30": "0–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  over_90: "90+ days",
};

export type OverdueMode = "expected_date" | "payment_terms";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function diffDays(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.round((a - b) / MS_PER_DAY);
}

export function parseIsoDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function bucketForDaysOverdue(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "over_90";
}

export interface DueDateInputs {
  expectedDate: string | Date | null | undefined;
  invoiceDate?: string | Date | null | undefined;
  termsDays?: number | null;
}

// Resolve the effective due date based on the analyst's chosen overdue mode.
// "expected_date" — use the explicit expected/forecast payment date as-is.
// "payment_terms" — invoiceDate + termsDays, falling back to expectedDate.
export function resolveDueDate(inputs: DueDateInputs, mode: OverdueMode): Date | null {
  if (mode === "expected_date") {
    return parseIsoDate(inputs.expectedDate);
  }
  const invoice = parseIsoDate(inputs.invoiceDate);
  if (invoice && typeof inputs.termsDays === "number" && Number.isFinite(inputs.termsDays)) {
    const due = new Date(invoice);
    due.setUTCDate(due.getUTCDate() + inputs.termsDays);
    return due;
  }
  return parseIsoDate(inputs.expectedDate);
}

export function daysOverdueOn(today: Date, dueDate: Date | null): number {
  if (!dueDate) return 0;
  return Math.max(0, diffDays(today, dueDate));
}

export type AgingBucketCounts = Record<AgingBucketKey, { count: number; amount: number }>;

export function emptyAgingCounts(): AgingBucketCounts {
  return {
    not_due: { count: 0, amount: 0 },
    "0_30": { count: 0, amount: 0 },
    "31_60": { count: 0, amount: 0 },
    "61_90": { count: 0, amount: 0 },
    over_90: { count: 0, amount: 0 },
  };
}

export interface AgingRowInput {
  amount: number;
  daysOverdue: number;
}

export function rollupAging(rows: AgingRowInput[]): AgingBucketCounts {
  const counts = emptyAgingCounts();
  for (const row of rows) {
    const bucket = bucketForDaysOverdue(row.daysOverdue);
    counts[bucket].count += 1;
    counts[bucket].amount += row.amount;
  }
  return counts;
}

export function totalOutstanding(counts: AgingBucketCounts): number {
  return AGING_BUCKET_KEYS.reduce((sum, key) => sum + counts[key].amount, 0);
}

// COS Analysis — earned-vs-invoiced math.

export interface EarnedVsInvoicedInput {
  plannedExpenditure: number; // contract / budget COS for this scope
  pctComplete: number;        // 0..1 — actual progress
  invoicedToDate: number;     // sum of cost line invoices captured to date
  toleranceBandPct: number;   // ±band, e.g. 10 = ±10%
}

export type EarnedVsInvoicedFlag = "over_billed" | "in_line" | "under_billed";

export interface EarnedVsInvoicedResult {
  earned: number;
  invoiced: number;
  variance: number;              // invoiced - earned (positive = over-billed)
  variancePct: number;           // variance / earned (or 0 if earned is 0)
  flag: EarnedVsInvoicedFlag;
}

export function computeEarnedVsInvoiced(input: EarnedVsInvoicedInput): EarnedVsInvoicedResult {
  const pct = clamp01(input.pctComplete);
  const earned = round2(input.plannedExpenditure * pct);
  const invoiced = round2(input.invoicedToDate);
  const variance = round2(invoiced - earned);
  const variancePct = earned === 0 ? (invoiced === 0 ? 0 : 1) : variance / earned;
  const band = Math.abs(input.toleranceBandPct) / 100;
  let flag: EarnedVsInvoicedFlag;
  if (variancePct > band) flag = "over_billed";
  else if (variancePct < -band) flag = "under_billed";
  else flag = "in_line";
  return { earned, invoiced, variance, variancePct, flag };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

// Concentration — what fraction of total outstanding is held by the top N entities.
export function topNConcentration(
  rows: Array<{ key: string; amount: number }>,
  topN: number,
): { topAmount: number; totalAmount: number; sharePct: number } {
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const sorted = [...rows].sort((a, b) => b.amount - a.amount).slice(0, topN);
  const topAmount = sorted.reduce((sum, r) => sum + r.amount, 0);
  const sharePct = total === 0 ? 0 : topAmount / total;
  return { topAmount: round2(topAmount), totalAmount: round2(total), sharePct };
}
