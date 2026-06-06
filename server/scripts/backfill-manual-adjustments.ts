#!/usr/bin/env tsx
/**
 * COPY backfill: populate manual_adjustments from the existing scattered
 * *_manual override tables. ADDITIVE — the source tables stay the live source
 * of truth and keep being written; this only copies their current rows into the
 * new unified table. No source row is deleted, no writer is changed, no read
 * path consumes manual_adjustments yet. No reported figure moves.
 *
 * Sources → manual_adjustments mapping (one logical override per row):
 *   tracker_monthly_manual      → up to 3 rows/row: realised / outstanding /
 *                                 budget. scope = project (projectInfoId set)
 *                                 else program. type = tracker_<trackerType>_<metric>.
 *   cashflow_weekly_manual      → opening_balance. scope = program.
 *   opex_weekly_manual          → opex_amount.     scope = opex.
 *   available_payment_overrides → override_value.  scope = program (keeps reason).
 *   fye_revised_budget_monthly  → amount.          scope = program. type = fye_revised_<metric>.
 *
 * fiscal_period_id is resolved from each source row's month/week key by
 * date-range containment against fiscal_periods (Sep–Aug FY). It is nullable, so
 * a row whose period is outside the seeded calendar is still copied (period left
 * null) — a COPY never drops a row, preserving row/value parity with the source.
 *
 * Idempotent guard: aborts if manual_adjustments already has rows (re-running
 * would duplicate). Use --dry-run to preview.
 *
 * Usage: tsx server/scripts/backfill-manual-adjustments.ts [--dry-run]
 */

import { pathToFileURL } from "node:url";

import { db, initializeDatabase } from "../db";
import {
  availablePaymentOverrides,
  cashflowWeeklyManual,
  fiscalPeriods,
  fyeRevisedBudgetMonthly,
  manualAdjustments,
  opexWeeklyManual,
  trackerMonthlyManual,
} from "@shared/schema/finance";

// ---- Fiscal-period resolver (date-range containment) ----
export interface FiscalPeriodRow {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export function resolvePeriodIdForDate(
  dateIso: string | null | undefined,
  periods: readonly FiscalPeriodRow[],
): number | null {
  if (!dateIso) return null;
  const iso = String(dateIso).slice(0, 10);
  const match = periods.find((p) => p.startDate <= iso && iso <= p.endDate);
  return match ? match.id : null;
}

export function resolvePeriodIdForMonthKey(
  monthKey: string | null | undefined,
  periods: readonly FiscalPeriodRow[],
): number | null {
  const m = /^(\d{4})-(\d{2})/.exec((monthKey ?? "").trim());
  return m ? resolvePeriodIdForDate(`${m[1]}-${m[2]}-01`, periods) : null;
}

// ---- Draft shape produced by the pure mappers ----
export type AdjustmentScope = "project" | "program" | "opex";
export interface ManualAdjustmentDraft {
  scope: AdjustmentScope;
  projectId: number | null;
  fiscalPeriodId: number | null;
  adjustmentType: string;
  value: string | null;
  reason: string;
  createdBy: number | null;
}

const asValue = (v: unknown): string | null => (v == null ? null : String(v));

// ---- Source row shapes (only the columns the mappers read) ----
export interface TrackerRow {
  trackerType: string | null;
  monthKey: string | null;
  realised: string | null;
  outstanding: string | null;
  budget: string | null;
  projectInfoId: number | null;
}
export interface CashflowWeeklyRow { weekStartDate: string | null; openingBalance: string | null; }
export interface OpexWeeklyRow { weekStartDate: string | null; opexAmount: string | null; }
export interface AvailablePaymentRow { weekStartDate: string | null; overrideValue: string | null; reason: string | null; }
export interface FyeRevisedRow { fye: number | null; metric: string | null; monthKey: string | null; amount: string | null; }

// ---- Pure mappers (one logical override per emitted draft) ----
export function mapTrackerMonthlyManual(
  rows: readonly TrackerRow[],
  periods: readonly FiscalPeriodRow[],
): ManualAdjustmentDraft[] {
  const out: ManualAdjustmentDraft[] = [];
  for (const r of rows) {
    const fiscalPeriodId = resolvePeriodIdForMonthKey(r.monthKey, periods);
    const scope: AdjustmentScope = r.projectInfoId != null ? "project" : "program";
    const trackerType = (r.trackerType ?? "unknown").trim() || "unknown";
    const metrics: Array<["realised" | "outstanding" | "budget", string | null]> = [
      ["realised", r.realised],
      ["outstanding", r.outstanding],
      ["budget", r.budget],
    ];
    for (const [metric, raw] of metrics) {
      if (raw == null) continue; // only copy populated value cells
      out.push({
        scope,
        projectId: r.projectInfoId ?? null,
        fiscalPeriodId,
        adjustmentType: `tracker_${trackerType}_${metric}`,
        value: asValue(raw),
        reason: "Backfilled from tracker_monthly_manual",
        createdBy: null,
      });
    }
  }
  return out;
}

export function mapCashflowWeeklyManual(
  rows: readonly CashflowWeeklyRow[],
  periods: readonly FiscalPeriodRow[],
): ManualAdjustmentDraft[] {
  return rows.map((r) => ({
    scope: "program",
    projectId: null,
    fiscalPeriodId: resolvePeriodIdForDate(r.weekStartDate, periods),
    adjustmentType: "cashflow_opening_balance",
    value: asValue(r.openingBalance),
    reason: "Backfilled from cashflow_weekly_manual",
    createdBy: null,
  }));
}

export function mapOpexWeeklyManual(
  rows: readonly OpexWeeklyRow[],
  periods: readonly FiscalPeriodRow[],
): ManualAdjustmentDraft[] {
  return rows.map((r) => ({
    scope: "opex",
    projectId: null,
    fiscalPeriodId: resolvePeriodIdForDate(r.weekStartDate, periods),
    adjustmentType: "opex_weekly",
    value: asValue(r.opexAmount),
    reason: "Backfilled from opex_weekly_manual",
    createdBy: null,
  }));
}

export function mapAvailablePaymentOverrides(
  rows: readonly AvailablePaymentRow[],
  periods: readonly FiscalPeriodRow[],
): ManualAdjustmentDraft[] {
  return rows.map((r) => ({
    scope: "program",
    projectId: null,
    fiscalPeriodId: resolvePeriodIdForDate(r.weekStartDate, periods),
    adjustmentType: "available_payment_override",
    value: asValue(r.overrideValue),
    reason: (r.reason && r.reason.trim()) || "Backfilled from available_payment_overrides",
    createdBy: null,
  }));
}

export function mapFyeRevisedBudgetMonthly(
  rows: readonly FyeRevisedRow[],
  periods: readonly FiscalPeriodRow[],
): ManualAdjustmentDraft[] {
  return rows.map((r) => {
    const metric = (r.metric ?? "unknown").trim() || "unknown";
    return {
      scope: "program" as const,
      projectId: null,
      fiscalPeriodId: resolvePeriodIdForMonthKey(r.monthKey, periods),
      adjustmentType: `fye_revised_${metric}`,
      value: asValue(r.amount),
      reason: "Backfilled from fye_revised_budget_monthly",
      createdBy: null,
    };
  });
}

function sumValues(drafts: readonly ManualAdjustmentDraft[]): number {
  return drafts.reduce((acc, d) => acc + (d.value == null ? 0 : Number(d.value)), 0);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`COPY backfill → manual_adjustments — ${dryRun ? "DRY RUN (no writes)" : "WRITE"}\n`);

  await initializeDatabase();

  const existing = await db.select({ id: manualAdjustments.id }).from(manualAdjustments).limit(1);
  if (existing.length > 0 && !dryRun) {
    throw new Error(
      "manual_adjustments already has rows — refusing to copy again (would duplicate). " +
        "Inspect/clear it first, or run with --dry-run to preview.",
    );
  }

  const periods = (await db
    .select({ id: fiscalPeriods.id, startDate: fiscalPeriods.startDate, endDate: fiscalPeriods.endDate })
    .from(fiscalPeriods)) as FiscalPeriodRow[];
  if (periods.length === 0) {
    throw new Error('No fiscal_periods found. Seed first: psql "$DATABASE_URL" -f scripts/seed-fiscal-years.sql');
  }
  console.log(`Loaded ${periods.length} fiscal periods.\n`);

  const trackerRows = (await db.select().from(trackerMonthlyManual)) as TrackerRow[];
  const cashflowRows = (await db.select().from(cashflowWeeklyManual)) as CashflowWeeklyRow[];
  const opexRows = (await db.select().from(opexWeeklyManual)) as OpexWeeklyRow[];
  const availRows = (await db.select().from(availablePaymentOverrides)) as AvailablePaymentRow[];
  const fyeRows = (await db.select().from(fyeRevisedBudgetMonthly)) as FyeRevisedRow[];

  const sources: Array<{ label: string; sourceCount: number; drafts: ManualAdjustmentDraft[] }> = [
    { label: "tracker_monthly_manual", sourceCount: trackerRows.length, drafts: mapTrackerMonthlyManual(trackerRows, periods) },
    { label: "cashflow_weekly_manual", sourceCount: cashflowRows.length, drafts: mapCashflowWeeklyManual(cashflowRows, periods) },
    { label: "opex_weekly_manual", sourceCount: opexRows.length, drafts: mapOpexWeeklyManual(opexRows, periods) },
    { label: "available_payment_overrides", sourceCount: availRows.length, drafts: mapAvailablePaymentOverrides(availRows, periods) },
    { label: "fye_revised_budget_monthly", sourceCount: fyeRows.length, drafts: mapFyeRevisedBudgetMonthly(fyeRows, periods) },
  ];

  const allDrafts: ManualAdjustmentDraft[] = [];
  for (const s of sources) {
    const unresolved = s.drafts.filter((d) => d.fiscalPeriodId == null).length;
    console.log(
      `${s.label}: ${s.sourceCount} source rows → ${s.drafts.length} adjustments · ` +
        `Σ value = ${sumValues(s.drafts).toFixed(2)}${unresolved ? ` · ${unresolved} with unresolved period` : ""}`,
    );
    allDrafts.push(...s.drafts);
  }
  console.log(`\nTotal adjustments to copy: ${allDrafts.length}`);

  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < allDrafts.length; i += CHUNK) {
    const chunk = allDrafts.slice(i, i + CHUNK).map((d) => ({
      scope: d.scope,
      projectId: d.projectId,
      fiscalPeriodId: d.fiscalPeriodId,
      adjustmentType: d.adjustmentType,
      value: d.value,
      reason: d.reason,
      createdBy: d.createdBy,
    }));
    if (chunk.length > 0) await db.insert(manualAdjustments).values(chunk);
    written += chunk.length;
  }
  console.log(`\nDone. Copied ${written} rows into manual_adjustments. Source tables untouched.`);
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
