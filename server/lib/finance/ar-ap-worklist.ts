/**
 * AR / AP / missing-invoice worklist engine — PURE, no DB.
 *
 * Reporting views only (no payment workflow — that is parked). These functions
 * filter + age the canonical line rows the cashflow surface already reads; they
 * do NOT compute revenue / COS / GP / cash and they do NOT change any finance
 * number. The single read path (AGENT_GUARDRAILS § 3.3.2 / S6) is untouched.
 *
 * Canonical signals used (the same ones the cashflow detail uses):
 *   - Invoicing:  col S = invoice number, col T = invoice-raised date.
 *   - Cash/receipt: col W = finance payment date + paid colour. A receipt /
 *     payment is REALISED only when the col-W date is present, not in the
 *     future, and its colour signal is BLACK (`isDateConfirmedCheck`, § 3.4 /
 *     § 3.7). RED / absent = not yet received / not yet paid.
 *
 * AR  = revenue line with a client invoice (S present, T set) NOT yet received.
 * AP  = cost line with a supplier invoice captured (S present, T set) NOT yet paid.
 * Missing = line whose expected invoice-raised date (T) is in the past with no
 *           invoice number (S empty) — both the revenue and the cost side.
 *
 * Disputed / written-off lines are excluded from the AR/AP aged rollups exactly
 * as the schema intends (finance.ts TF-7 / TF-8 column comments) so the worklist
 * does not keep nagging on a line that is under dispute or already written off.
 */

import { isDateConfirmedCheck } from "../cashflow-helpers";

export type AgeBucket = "0-30" | "31-60" | "61-90" | "90+";

export const AGE_BUCKETS: readonly AgeBucket[] = ["0-30", "31-60", "61-90", "90+"];

/** Best-effort provenance so every row drills back to its workbook cell. */
export interface WorklistSourceRef {
  sourceSheet: string | null;
  sourceRow: number | null;
  /** Cell ref within the sheet (no sheet prefix), e.g. "S42". May be null when
   * the source workbook did not record one. */
  sourceCell: string | null;
}

/** Narrow input shapes — the repository maps raw rows onto these. Keeping the
 * engine decoupled from Drizzle row types makes it unit-testable without a DB. */
export interface RevenueWorklistInput {
  lineId: number;
  projectId: number | null;
  projectName: string | null;
  label: string | null;
  invoiceNumber: string | null; // col S
  invoiceDate: string | null; // col T (ISO)
  amountExVat: string | number | null; // col U
  paidDate: string | null; // col W
  paidDateFontColor: string | null;
  paidDateConfirmed: boolean | null;
  inBankDate: string | null;
  status: string | null;
  disputeOpenedAt: Date | string | null;
  disputeResolvedAt: Date | string | null;
  writeOffAuthorisedAt: Date | string | null;
  source: WorklistSourceRef;
}

export interface CostWorklistInput {
  lineId: number;
  projectId: number | null;
  projectName: string | null;
  supplierName: string | null;
  label: string | null;
  invoiceNumber: string | null; // col S
  invoiceDate: string | null; // col T (ISO)
  amountExVat: string | number | null; // col Q (actual total)
  paidDate: string | null; // col W
  paidDateFontColor: string | null;
  paidDateConfirmed: boolean | null;
  status: string | null;
  disputeOpenedAt: Date | string | null;
  disputeResolvedAt: Date | string | null;
  source: WorklistSourceRef;
}

export interface AgedRow {
  lineId: number;
  projectId: number | null;
  projectName: string | null;
  /** Supplier (AP) / customer-side label is project for AR. */
  counterpartyName: string | null;
  label: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number;
  ageDays: number;
  ageBucket: AgeBucket;
  source: WorklistSourceRef;
}

export interface MissingInvoiceRow {
  side: "revenue" | "cost";
  lineId: number;
  projectId: number | null;
  projectName: string | null;
  counterpartyName: string | null;
  label: string | null;
  expectedInvoiceDate: string | null;
  daysOverdue: number;
  amountExVat: number;
  source: WorklistSourceRef;
}

export interface BucketTotal {
  count: number;
  amount: number;
}

export type BucketTotals = Record<AgeBucket, BucketTotal> & { total: BucketTotal };

export interface AgedWorklist {
  asOf: string;
  rows: AgedRow[];
  buckets: BucketTotals;
}

export interface MissingInvoiceWorklist {
  asOf: string;
  rows: MissingInvoiceRow[];
  summary: {
    revenue: BucketTotal;
    cost: BucketTotal;
    total: BucketTotal;
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

const r2 = (n: number): number => Number(n.toFixed(2));

export const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const toIsoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed || trimmed === "-") return null;
    return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  }
  return null;
};

const hasText = (v: string | null | undefined): boolean => !!(v && String(v).trim());

/**
 * Whole days between two ISO dates (toIso − fromIso). Positive when `toIso`
 * is after `fromIso`. UTC-anchored so it never drifts with the host timezone.
 */
export const daysBetween = (fromIso: string, toIso: string): number => {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
};

/** South-African calendar date (UTC+2, no DST) — the anchor the rest of the
 * finance read paths use so "today" agrees across surfaces. */
export const sastTodayIso = (now: number = Date.now()): string =>
  new Date(now + 120 * 60 * 1000).toISOString().slice(0, 10);

export const ageBucket = (days: number): AgeBucket => {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
};

/**
 * Realised on col W (BLACK) per § 3.4 / § 3.7: a present, non-future date whose
 * colour signal confirms it. RED or absent ⇒ not realised (not received / not
 * paid). Future-dated BLACK is treated as not-yet-realised, mirroring the
 * cashflow detail's `paymentDateBlack` guard.
 */
export const isRealisedOnW = (
  paidDate: string | null,
  confirmed: boolean | null,
  fontColor: string | null,
  asOf: string,
): boolean => {
  const iso = toIsoDate(paidDate);
  if (!iso) return false;
  if (iso > asOf) return false; // future-dated — not yet realised
  return isDateConfirmedCheck(confirmed, fontColor);
};

const isResolvedDispute = (opened: unknown, resolved: unknown): boolean =>
  !!opened && !resolved;

const isExcludedRevenue = (row: RevenueWorklistInput): boolean => {
  const status = (row.status ?? "").toLowerCase();
  if (status === "disputed" || status === "written_off") return true;
  if (row.writeOffAuthorisedAt) return true;
  return isResolvedDispute(row.disputeOpenedAt, row.disputeResolvedAt);
};

const isExcludedCost = (row: CostWorklistInput): boolean => {
  const status = (row.status ?? "").toLowerCase();
  if (status === "disputed") return true;
  return isResolvedDispute(row.disputeOpenedAt, row.disputeResolvedAt);
};

const emptyBucketTotals = (): BucketTotals => ({
  "0-30": { count: 0, amount: 0 },
  "31-60": { count: 0, amount: 0 },
  "61-90": { count: 0, amount: 0 },
  "90+": { count: 0, amount: 0 },
  total: { count: 0, amount: 0 },
});

const tallyBuckets = (rows: AgedRow[]): BucketTotals => {
  const buckets = emptyBucketTotals();
  for (const row of rows) {
    const b = buckets[row.ageBucket];
    b.count += 1;
    b.amount += row.amountExVat;
    buckets.total.count += 1;
    buckets.total.amount += row.amountExVat;
  }
  for (const key of [...AGE_BUCKETS, "total" as const]) {
    buckets[key].amount = r2(buckets[key].amount);
  }
  return buckets;
};

// ── AR ───────────────────────────────────────────────────────────────────

/**
 * Accounts Receivable: revenue lines invoiced to the client (S present, T set)
 * that have NOT been received on col W. Aged from the invoice-raised date (T).
 */
export function buildReceivables(
  rows: readonly RevenueWorklistInput[],
  asOf: string = sastTodayIso(),
): AgedWorklist {
  const aged: AgedRow[] = [];
  for (const row of rows) {
    if (!hasText(row.invoiceNumber)) continue; // S present
    const invoiceDate = toIsoDate(row.invoiceDate);
    if (!invoiceDate) continue; // T set (needed to age)
    if (isExcludedRevenue(row)) continue;
    // Received signal on col W (BLACK), or money already in the bank.
    const received =
      isRealisedOnW(row.paidDate, row.paidDateConfirmed, row.paidDateFontColor, asOf) ||
      !!toIsoDate(row.inBankDate);
    if (received) continue;

    const ageDays = Math.max(0, daysBetween(invoiceDate, asOf));
    aged.push({
      lineId: row.lineId,
      projectId: row.projectId,
      projectName: row.projectName,
      counterpartyName: row.projectName,
      label: row.label,
      invoiceNumber: row.invoiceNumber,
      invoiceDate,
      amountExVat: r2(toNum(row.amountExVat)),
      ageDays,
      ageBucket: ageBucket(ageDays),
      source: row.source,
    });
  }
  aged.sort((a, b) => b.ageDays - a.ageDays);
  return { asOf, rows: aged, buckets: tallyBuckets(aged) };
}

// ── AP ───────────────────────────────────────────────────────────────────

/**
 * Accounts Payable: cost lines with a supplier invoice captured (S present,
 * T set) that have NOT been paid on col W. Aged from the invoice-raised date.
 */
export function buildPayables(
  rows: readonly CostWorklistInput[],
  asOf: string = sastTodayIso(),
): AgedWorklist {
  const aged: AgedRow[] = [];
  for (const row of rows) {
    if (!hasText(row.invoiceNumber)) continue; // S present
    const invoiceDate = toIsoDate(row.invoiceDate);
    if (!invoiceDate) continue; // T set (needed to age)
    if (isExcludedCost(row)) continue;
    const paid = isRealisedOnW(
      row.paidDate,
      row.paidDateConfirmed,
      row.paidDateFontColor,
      asOf,
    );
    if (paid) continue;

    const ageDays = Math.max(0, daysBetween(invoiceDate, asOf));
    aged.push({
      lineId: row.lineId,
      projectId: row.projectId,
      projectName: row.projectName,
      counterpartyName: row.supplierName,
      label: row.label,
      invoiceNumber: row.invoiceNumber,
      invoiceDate,
      amountExVat: r2(toNum(row.amountExVat)),
      ageDays,
      ageBucket: ageBucket(ageDays),
      source: row.source,
    });
  }
  aged.sort((a, b) => b.ageDays - a.ageDays);
  return { asOf, rows: aged, buckets: tallyBuckets(aged) };
}

// ── Missing invoices ───────────────────────────────────────────────────────

/**
 * Past-dated missing-invoice worklist: every line whose expected invoice-raised
 * date (T) is strictly in the past AND has no invoice number (S empty). Covers
 * both the revenue side (we should have invoiced the client) and the cost side
 * (supplier invoice not yet captured). Sorted most-overdue first.
 */
export function buildMissingInvoices(
  revenue: readonly RevenueWorklistInput[],
  cost: readonly CostWorklistInput[],
  asOf: string = sastTodayIso(),
): MissingInvoiceWorklist {
  const rows: MissingInvoiceRow[] = [];
  const summary = {
    revenue: { count: 0, amount: 0 },
    cost: { count: 0, amount: 0 },
    total: { count: 0, amount: 0 },
  };

  for (const row of revenue) {
    if (hasText(row.invoiceNumber)) continue; // S empty
    const expected = toIsoDate(row.invoiceDate);
    if (!expected || expected >= asOf) continue; // T in the past
    if (isExcludedRevenue(row)) continue;
    const amount = r2(toNum(row.amountExVat));
    rows.push({
      side: "revenue",
      lineId: row.lineId,
      projectId: row.projectId,
      projectName: row.projectName,
      counterpartyName: row.projectName,
      label: row.label,
      expectedInvoiceDate: expected,
      daysOverdue: daysBetween(expected, asOf),
      amountExVat: amount,
      source: row.source,
    });
    summary.revenue.count += 1;
    summary.revenue.amount += amount;
  }

  for (const row of cost) {
    if (hasText(row.invoiceNumber)) continue; // S empty
    const expected = toIsoDate(row.invoiceDate);
    if (!expected || expected >= asOf) continue; // T in the past
    if (isExcludedCost(row)) continue;
    const amount = r2(toNum(row.amountExVat));
    rows.push({
      side: "cost",
      lineId: row.lineId,
      projectId: row.projectId,
      projectName: row.projectName,
      counterpartyName: row.supplierName,
      label: row.label,
      expectedInvoiceDate: expected,
      daysOverdue: daysBetween(expected, asOf),
      amountExVat: amount,
      source: row.source,
    });
    summary.cost.count += 1;
    summary.cost.amount += amount;
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  summary.revenue.amount = r2(summary.revenue.amount);
  summary.cost.amount = r2(summary.cost.amount);
  summary.total.count = summary.revenue.count + summary.cost.count;
  summary.total.amount = r2(summary.revenue.amount + summary.cost.amount);

  return { asOf, rows, summary };
}
