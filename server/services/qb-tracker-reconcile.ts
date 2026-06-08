/**
 * Company-wide, period-bucketed tracker-vs-QuickBooks reconciliation (R2).
 *
 * Matches the project trackers (source of truth) against QuickBooks DETAIL on
 * INVOICE NUMBER + ex-VAT amount — COMPANY-WIDE, NO project dimension (QB cost
 * bills aren't project-tagged; see docs/finance-reconciliation.md). Both sides
 * ex-VAT. The app COMPARES and flags; it NEVER adjusts a tracker (§ 3.4).
 *
 *   COS = QB Bills   ↔ normalized_cost_lines
 *   REV = QB Invoices ↔ normalized_revenue_lines
 *
 * Each normalized invoice number is classified matched | amount_variance |
 * tracker_only | qb_only, with both dates recorded and a `timing` flag when a
 * matched invoice falls in different fiscal periods on the two sides. Summaries
 * roll the SAME line dataset to day / week / month; GP per period = REV − COS
 * on each side. Persisted snapshot-guarded into qb_recon_line / qb_recon_summary.
 *
 * The pure functions (reconcileStream / summarise) take an injected period
 * resolver so they're unit-testable without a DB or QuickBooks.
 */

import { and, eq, isNull } from "drizzle-orm";

import {
  normalizedCostLines,
  normalizedRevenueLines,
  fiscalPeriods,
} from "@shared/schema/finance";
import { qbReconLine, qbReconSummary } from "@shared/schema/qb-recon";
import { qbReconIgnores, qbRevenueReconIgnores } from "@shared/schema/integrations";
import { db } from "../db";
import { NORMALIZERS } from "../lib/finance/qb-match-rate";
import {
  billRawToSummary,
  invoiceRawToSummary,
} from "./quickbooks-reconciliation-service";
import { getBills, getInvoices } from "./quickbooks-service";
import { resolvePeriodIdForDate, type FiscalPeriodRow } from "../scripts/backfill-fiscal-period";

export type ReconStream = "COS" | "REV";
export type ReconLineStatus = "matched" | "amount_variance" | "tracker_only" | "qb_only";
export type PeriodGrain = "day" | "week" | "month";

/** R1 — same tie tolerance the rest of finance uses. Both sides ex-VAT. */
export const QB_RECON_TOLERANCE = 1;

/** The recommended normalizer from the R1 probe: strips supplier alpha prefixes
 *  + leading zeros, with amount-within-R1 kept as a hard gate so number
 *  collisions fall to amount_variance rather than false-matching. */
export const QB_RECON_NORMALIZER = NORMALIZERS.digits_no_leading_zeros;

export interface ReconInput {
  number: string | null;
  amountExVat: number;
  date: string | null; // YYYY-MM-DD
}

export interface ReconLine {
  stream: ReconStream;
  invoiceNoRaw: string;
  invoiceNoNorm: string;
  trackerAmountExVat: number | null;
  qbAmountExVat: number | null;
  /** tracker − qb (null when one side is missing). */
  delta: number | null;
  status: ReconLineStatus;
  trackerDate: string | null;
  qbDate: string | null;
  /** Fiscal period of the line's primary date (tracker, else QB). */
  fiscalPeriodId: number | null;
  /** Matched invoice whose two dates fall in different fiscal periods. */
  timingFlag: boolean;
}

export type ResolvePeriod = (dateIso: string | null) => number | null;

const round2 = (n: number): number => Number(n.toFixed(2));

interface SideAgg {
  amountExVat: number;
  date: string | null;
  raws: string[];
}

function aggregate(
  records: readonly ReconInput[],
  normalize: (raw: string | null | undefined) => string,
): Map<string, SideAgg> {
  const byKey = new Map<string, SideAgg>();
  for (const r of records) {
    const key = normalize(r.number);
    if (!key) continue; // blank / unparseable number → not matchable on number
    const slot = byKey.get(key) ?? { amountExVat: 0, date: null, raws: [] };
    slot.amountExVat += r.amountExVat;
    if (r.date && (slot.date == null || r.date < slot.date)) slot.date = r.date; // earliest
    if (r.number && !slot.raws.includes(r.number)) slot.raws.push(r.number);
    byKey.set(key, slot);
  }
  for (const s of byKey.values()) s.amountExVat = round2(s.amountExVat);
  return byKey;
}

/** PURE: two-way match one stream → one ReconLine per normalized invoice number. */
export function reconcileStream(
  stream: ReconStream,
  qb: readonly ReconInput[],
  tracker: readonly ReconInput[],
  resolvePeriod: ResolvePeriod,
  normalize: (raw: string | null | undefined) => string = QB_RECON_NORMALIZER,
  tolerance: number = QB_RECON_TOLERANCE,
): ReconLine[] {
  const qbAgg = aggregate(qb, normalize);
  const trAgg = aggregate(tracker, normalize);
  const keys = new Set<string>([...qbAgg.keys(), ...trAgg.keys()]);
  const out: ReconLine[] = [];

  for (const key of keys) {
    const q = qbAgg.get(key) ?? null;
    const t = trAgg.get(key) ?? null;
    const trackerDate = t?.date ?? null;
    const qbDate = q?.date ?? null;
    const primaryDate = trackerDate ?? qbDate;
    const fiscalPeriodId = resolvePeriod(primaryDate);

    let status: ReconLineStatus;
    let delta: number | null = null;
    let timingFlag = false;

    if (q && t) {
      delta = round2(t.amountExVat - q.amountExVat);
      status = Math.abs(delta) <= tolerance ? "matched" : "amount_variance";
      // Timing: a number-matched invoice booked in different fiscal periods.
      const tp = resolvePeriod(trackerDate);
      const qp = resolvePeriod(qbDate);
      timingFlag = tp != null && qp != null && tp !== qp;
    } else if (t) {
      status = "tracker_only";
    } else {
      status = "qb_only";
    }

    out.push({
      stream,
      invoiceNoRaw: (t?.raws ?? q?.raws ?? []).join("|"),
      invoiceNoNorm: key,
      trackerAmountExVat: t ? t.amountExVat : null,
      qbAmountExVat: q ? q.amountExVat : null,
      delta,
      status,
      trackerDate,
      qbDate,
      fiscalPeriodId,
      timingFlag,
    });
  }
  return out;
}

/** ISO-week key (YYYY-Www, Monday-start) for a YYYY-MM-DD date. */
export function isoWeekKey(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyFor(dateIso: string, grain: PeriodGrain): string {
  const iso = dateIso.slice(0, 10);
  if (grain === "day") return iso;
  if (grain === "month") return iso.slice(0, 7);
  return isoWeekKey(iso);
}

export interface ReconSummaryRow {
  grain: PeriodGrain;
  periodKey: string;
  fiscalPeriodId: number | null;
  stream: ReconStream;
  trackerTotal: number;
  qbTotal: number;
  matchedTotal: number;
  varianceTotal: number;
  trackerOnlyTotal: number;
  qbOnlyTotal: number;
}

/** PURE: roll the line dataset to (grain, periodKey, fiscalPeriodId, stream). */
export function summarise(lines: readonly ReconLine[], grain: PeriodGrain): ReconSummaryRow[] {
  const byKey = new Map<string, ReconSummaryRow>();
  for (const l of lines) {
    const primaryDate = l.trackerDate ?? l.qbDate;
    if (!primaryDate) continue;
    const periodKey = periodKeyFor(primaryDate, grain);
    const mapKey = `${grain}|${periodKey}|${l.fiscalPeriodId ?? ""}|${l.stream}`;
    const row =
      byKey.get(mapKey) ??
      {
        grain,
        periodKey,
        fiscalPeriodId: l.fiscalPeriodId,
        stream: l.stream,
        trackerTotal: 0,
        qbTotal: 0,
        matchedTotal: 0,
        varianceTotal: 0,
        trackerOnlyTotal: 0,
        qbOnlyTotal: 0,
      };
    if (l.trackerAmountExVat != null) row.trackerTotal += l.trackerAmountExVat;
    if (l.qbAmountExVat != null) row.qbTotal += l.qbAmountExVat;
    if (l.status === "matched") row.matchedTotal += l.trackerAmountExVat ?? 0;
    else if (l.status === "amount_variance") row.varianceTotal += Math.abs(l.delta ?? 0);
    else if (l.status === "tracker_only") row.trackerOnlyTotal += l.trackerAmountExVat ?? 0;
    else if (l.status === "qb_only") row.qbOnlyTotal += l.qbAmountExVat ?? 0;
    byKey.set(mapKey, row);
  }
  for (const r of byKey.values()) {
    r.trackerTotal = round2(r.trackerTotal);
    r.qbTotal = round2(r.qbTotal);
    r.matchedTotal = round2(r.matchedTotal);
    r.varianceTotal = round2(r.varianceTotal);
    r.trackerOnlyTotal = round2(r.trackerOnlyTotal);
    r.qbOnlyTotal = round2(r.qbOnlyTotal);
  }
  return [...byKey.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.stream.localeCompare(b.stream));
}

// ---------------------------------------------------------------------------
// Refresh — pull QB for the open window, recompute, write snapshot-guarded
// ---------------------------------------------------------------------------

export type DbOrTx = typeof db;

export interface QbReconRefreshSummary {
  windowStart: string;
  windowEnd: string;
  qbAvailable: boolean;
  lineRows: number;
  summaryRows: number;
}

const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
};

function defaultWindow(monthsBack = 6): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Recompute the company-wide tracker-vs-QB reconciliation for the open window
 * and persist qb_recon_line + qb_recon_summary (snapshot-guarded: soft-close all
 * active rows, insert the fresh set). Best-effort: if QuickBooks is unavailable
 * it writes nothing and returns qbAvailable=false. Never mutates a tracker.
 */
export async function refreshQbTrackerReconciliation(
  dbi: DbOrTx,
  opts: { monthsBack?: number } = {},
): Promise<QbReconRefreshSummary> {
  const { start, end } = defaultWindow(opts.monthsBack ?? 6);

  // Active recon-ignores (excluded from the gap; still surfaced separately).
  const [ignoredBills, ignoredInvoices] = await Promise.all([
    dbi.select({ qbBillId: qbReconIgnores.qbBillId }).from(qbReconIgnores).where(isNull(qbReconIgnores.deletedAt)),
    dbi.select({ qbInvoiceId: qbRevenueReconIgnores.qbInvoiceId }).from(qbRevenueReconIgnores).where(isNull(qbRevenueReconIgnores.deletedAt)),
  ]);
  const ignoredBillIds = new Set((ignoredBills as Array<{ qbBillId: string }>).map((r) => r.qbBillId));
  const ignoredInvoiceIds = new Set((ignoredInvoices as Array<{ qbInvoiceId: string }>).map((r) => r.qbInvoiceId));

  // QuickBooks side (best-effort).
  let qbCos: ReconInput[];
  let qbRev: ReconInput[];
  try {
    const [bills, invoices] = await Promise.all([getBills(start, end), getInvoices(start, end)]);
    qbCos = ((bills as { QueryResponse?: { Bill?: unknown[] } })?.QueryResponse?.Bill ?? [])
      .map((b) => billRawToSummary(b))
      .filter((s) => !ignoredBillIds.has(s.id))
      .map((s) => ({ number: s.docNumber, amountExVat: toNum(s.qbAmountExVat ?? s.totalAmount), date: isoDate(s.txnDate) }));
    qbRev = ((invoices as { QueryResponse?: { Invoice?: unknown[] } })?.QueryResponse?.Invoice ?? [])
      .map((i) => invoiceRawToSummary(i))
      .filter((s) => !ignoredInvoiceIds.has(s.id))
      .map((s) => ({ number: s.docNumber, amountExVat: toNum(s.totalAmount), date: isoDate(s.txnDate) }));
  } catch (err) {
    console.warn("[qb-tracker-reconcile] QuickBooks unavailable — skipping refresh:", err instanceof Error ? err.message : String(err));
    return { windowStart: start, windowEnd: end, qbAvailable: false, lineRows: 0, summaryRows: 0 };
  }

  // Tracker side + fiscal calendar.
  const [costRows, revRows, periods] = await Promise.all([
    dbi
      .select({ invoiceNumber: normalizedCostLines.invoiceNumber, amountExVat: normalizedCostLines.amountExVat, invoiceDate: normalizedCostLines.invoiceDate })
      .from(normalizedCostLines)
      .where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
    dbi
      .select({ invoiceNumber: normalizedRevenueLines.invoiceNumber, amountExVat: normalizedRevenueLines.amountExVat, invoiceDate: normalizedRevenueLines.invoiceDate })
      .from(normalizedRevenueLines)
      .where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
    dbi.select({ id: fiscalPeriods.id, startDate: fiscalPeriods.startDate, endDate: fiscalPeriods.endDate }).from(fiscalPeriods) as Promise<FiscalPeriodRow[]>,
  ]);

  const inWindow = (d: string | null): boolean => d != null && d >= start && d <= end;
  const trCos: ReconInput[] = (costRows as Array<{ invoiceNumber: string | null; amountExVat: string | null; invoiceDate: unknown }>)
    .map((r) => ({ number: r.invoiceNumber, amountExVat: toNum(r.amountExVat), date: isoDate(r.invoiceDate) }))
    .filter((r) => inWindow(r.date));
  const trRev: ReconInput[] = (revRows as Array<{ invoiceNumber: string | null; amountExVat: string | null; invoiceDate: unknown }>)
    .map((r) => ({ number: r.invoiceNumber, amountExVat: toNum(r.amountExVat), date: isoDate(r.invoiceDate) }))
    .filter((r) => inWindow(r.date));

  const resolvePeriod: ResolvePeriod = (d) => resolvePeriodIdForDate(d, periods);
  const lines = [
    ...reconcileStream("COS", qbCos, trCos, resolvePeriod),
    ...reconcileStream("REV", qbRev, trRev, resolvePeriod),
  ];
  const summaries: ReconSummaryRow[] = [];
  for (const grain of ["day", "week", "month"] as const) summaries.push(...summarise(lines, grain));

  const now = new Date();
  // Snapshot refresh: close all active rows, insert the fresh set.
  await dbi.update(qbReconLine).set({ effectiveTo: now }).where(isNull(qbReconLine.effectiveTo));
  await dbi.update(qbReconSummary).set({ effectiveTo: now }).where(isNull(qbReconSummary.effectiveTo));

  if (lines.length > 0) {
    await dbi.insert(qbReconLine).values(
      lines.map((l) => ({
        stream: l.stream,
        invoiceNoRaw: l.invoiceNoRaw || null,
        invoiceNoNorm: l.invoiceNoNorm,
        trackerAmountExVat: l.trackerAmountExVat != null ? l.trackerAmountExVat.toFixed(2) : null,
        qbAmountExVat: l.qbAmountExVat != null ? l.qbAmountExVat.toFixed(2) : null,
        delta: l.delta != null ? l.delta.toFixed(2) : null,
        status: l.status,
        trackerDate: l.trackerDate,
        qbDate: l.qbDate,
        fiscalPeriodId: l.fiscalPeriodId,
        timingFlag: l.timingFlag,
        computedAt: now,
        effectiveFrom: now,
        effectiveTo: null,
      })),
    );
  }
  if (summaries.length > 0) {
    await dbi.insert(qbReconSummary).values(
      summaries.map((s) => ({
        periodGrain: s.grain,
        periodKey: s.periodKey,
        fiscalPeriodId: s.fiscalPeriodId,
        stream: s.stream,
        trackerTotal: s.trackerTotal.toFixed(2),
        qbTotal: s.qbTotal.toFixed(2),
        matchedTotal: s.matchedTotal.toFixed(2),
        varianceTotal: s.varianceTotal.toFixed(2),
        trackerOnlyTotal: s.trackerOnlyTotal.toFixed(2),
        qbOnlyTotal: s.qbOnlyTotal.toFixed(2),
        computedAt: now,
        effectiveFrom: now,
        effectiveTo: null,
      })),
    );
  }

  return { windowStart: start, windowEnd: end, qbAvailable: true, lineRows: lines.length, summaryRows: summaries.length };
}

// ---------------------------------------------------------------------------
// Read — period summary (REV/COS/GP) + the lines worklist
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  periodKey: string;
  fiscalPeriodId: number | null;
  rev: ReconSummaryRow | null;
  cos: ReconSummaryRow | null;
  /** GP per period = REV − COS on each side (derived, never stored). */
  gpTracker: number;
  gpQb: number;
  gpDelta: number;
}

export async function getQbReconSummary(dbi: DbOrTx, grain: PeriodGrain): Promise<PeriodSummary[]> {
  const rows = (await dbi
    .select()
    .from(qbReconSummary)
    .where(and(eq(qbReconSummary.periodGrain, grain), isNull(qbReconSummary.effectiveTo)))) as Array<typeof qbReconSummary.$inferSelect>;

  const byPeriod = new Map<string, PeriodSummary>();
  const asRow = (r: typeof qbReconSummary.$inferSelect): ReconSummaryRow => ({
    grain,
    periodKey: r.periodKey,
    fiscalPeriodId: r.fiscalPeriodId,
    stream: r.stream as ReconStream,
    trackerTotal: toNum(r.trackerTotal),
    qbTotal: toNum(r.qbTotal),
    matchedTotal: toNum(r.matchedTotal),
    varianceTotal: toNum(r.varianceTotal),
    trackerOnlyTotal: toNum(r.trackerOnlyTotal),
    qbOnlyTotal: toNum(r.qbOnlyTotal),
  });

  for (const r of rows) {
    const ps =
      byPeriod.get(r.periodKey) ??
      { periodKey: r.periodKey, fiscalPeriodId: r.fiscalPeriodId, rev: null, cos: null, gpTracker: 0, gpQb: 0, gpDelta: 0 };
    if (r.stream === "REV") ps.rev = asRow(r);
    else if (r.stream === "COS") ps.cos = asRow(r);
    byPeriod.set(r.periodKey, ps);
  }
  const out = [...byPeriod.values()];
  for (const ps of out) {
    ps.gpTracker = round2((ps.rev?.trackerTotal ?? 0) - (ps.cos?.trackerTotal ?? 0));
    ps.gpQb = round2((ps.rev?.qbTotal ?? 0) - (ps.cos?.qbTotal ?? 0));
    ps.gpDelta = round2(ps.gpTracker - ps.gpQb);
  }
  return out.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

export async function getQbReconLines(
  dbi: DbOrTx,
  filter: { status?: ReconLineStatus; fiscalPeriodId?: number } = {},
): Promise<Array<typeof qbReconLine.$inferSelect>> {
  const conds = [isNull(qbReconLine.effectiveTo)];
  if (filter.status) conds.push(eq(qbReconLine.status, filter.status));
  if (filter.fiscalPeriodId != null) conds.push(eq(qbReconLine.fiscalPeriodId, filter.fiscalPeriodId));
  return (await dbi
    .select()
    .from(qbReconLine)
    .where(and(...conds))) as Array<typeof qbReconLine.$inferSelect>;
}
