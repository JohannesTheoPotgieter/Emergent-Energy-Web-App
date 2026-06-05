#!/usr/bin/env tsx
/**
 * Backfill fiscal_period_id on the periodised finance tables from each row's
 * existing month/week key. Additive metadata only — no read-path change, no
 * recomputation of any figure.
 *
 * Tables (each got a nullable fiscal_period_id FK in migration
 * 0090_fiscal_period_backbone.sql):
 *   - cashflow_weekly_manual     ← week_start_date (date)
 *   - opex_budget_monthly        ← month_key ("YYYY-MM")
 *   - tracker_monthly_manual     ← month_key ("YYYY-MM")
 *   - fye_revised_budget_monthly ← month_key ("YYYY-MM")
 *
 * Mapping is by DATE-RANGE CONTAINMENT against fiscal_periods (Sep–Aug FY):
 * a month key resolves via the first of that month; a week key via its start
 * date. fiscal_periods are contiguous, non-overlapping monthly rows, so a date
 * inside the seeded calendar resolves to exactly one period.
 *
 * The calendar must be seeded first (scripts/seed-fiscal-years.sql populates
 * fiscal_years + fiscal_periods for FY26/FY27). The script aborts if no periods
 * exist. Idempotent: only rows with fiscal_period_id IS NULL are touched.
 *
 * Usage: tsx server/scripts/backfill-fiscal-period.ts [--dry-run]
 */

import { pathToFileURL } from "node:url";

import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { db, initializeDatabase } from "../db";
import {
  cashflowWeeklyManual,
  fiscalPeriods,
  fyeRevisedBudgetMonthly,
  opexBudgetMonthly,
  trackerMonthlyManual,
} from "@shared/schema/finance";

export interface FiscalPeriodRow {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/** Every period whose [startDate, endDate] inclusive range contains dateIso.
 *  For a well-formed calendar this is exactly one; exposed so callers/tests can
 *  assert the "exactly one" invariant. ISO date strings compare chronologically. */
export function periodsContainingDate(
  dateIso: string,
  periods: readonly FiscalPeriodRow[],
): FiscalPeriodRow[] {
  return periods.filter((p) => p.startDate <= dateIso && dateIso <= p.endDate);
}

/** "YYYY-MM"(-anything) → first-of-month "YYYY-MM-01"; null when unparseable. */
export function monthKeyToFirstOfMonth(monthKey: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec((monthKey ?? "").trim());
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export function resolvePeriodIdForDate(
  dateIso: string | null | undefined,
  periods: readonly FiscalPeriodRow[],
): number | null {
  if (!dateIso) return null;
  const iso = String(dateIso).slice(0, 10);
  const matches = periodsContainingDate(iso, periods);
  return matches.length > 0 ? matches[0].id : null;
}

export function resolvePeriodIdForMonthKey(
  monthKey: string | null | undefined,
  periods: readonly FiscalPeriodRow[],
): number | null {
  const first = monthKeyToFirstOfMonth(monthKey);
  return first ? resolvePeriodIdForDate(first, periods) : null;
}

interface TablePlan {
  label: string;
  table: PgTable;
  idColumn: AnyPgColumn;
  fiscalPeriodColumn: AnyPgColumn;
  /** Returns the raw key (month_key or week_start_date) for a row. */
  getKey: (row: Record<string, unknown>) => string | null;
  resolve: (key: string | null, periods: FiscalPeriodRow[]) => number | null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Backfill fiscal_period_id — ${dryRun ? "DRY RUN (no writes)" : "WRITE"}\n`);

  await initializeDatabase();

  const periodRows = (await db
    .select({
      id: fiscalPeriods.id,
      startDate: fiscalPeriods.startDate,
      endDate: fiscalPeriods.endDate,
    })
    .from(fiscalPeriods)) as FiscalPeriodRow[];

  if (periodRows.length === 0) {
    throw new Error(
      "No fiscal_periods found. Seed the calendar first:\n" +
        "  psql \"$DATABASE_URL\" -f scripts/seed-fiscal-years.sql",
    );
  }
  console.log(`Loaded ${periodRows.length} fiscal periods.\n`);

  const plans: TablePlan[] = [
    {
      label: "cashflow_weekly_manual",
      table: cashflowWeeklyManual,
      idColumn: cashflowWeeklyManual.id,
      fiscalPeriodColumn: cashflowWeeklyManual.fiscalPeriodId,
      getKey: (r) => (r.weekStartDate == null ? null : String(r.weekStartDate)),
      resolve: resolvePeriodIdForDate,
    },
    {
      label: "opex_budget_monthly",
      table: opexBudgetMonthly,
      idColumn: opexBudgetMonthly.id,
      fiscalPeriodColumn: opexBudgetMonthly.fiscalPeriodId,
      getKey: (r) => (r.monthKey == null ? null : String(r.monthKey)),
      resolve: resolvePeriodIdForMonthKey,
    },
    {
      label: "tracker_monthly_manual",
      table: trackerMonthlyManual,
      idColumn: trackerMonthlyManual.id,
      fiscalPeriodColumn: trackerMonthlyManual.fiscalPeriodId,
      getKey: (r) => (r.monthKey == null ? null : String(r.monthKey)),
      resolve: resolvePeriodIdForMonthKey,
    },
    {
      label: "fye_revised_budget_monthly",
      table: fyeRevisedBudgetMonthly,
      idColumn: fyeRevisedBudgetMonthly.id,
      fiscalPeriodColumn: fyeRevisedBudgetMonthly.fiscalPeriodId,
      getKey: (r) => (r.monthKey == null ? null : String(r.monthKey)),
      resolve: resolvePeriodIdForMonthKey,
    },
  ];

  let grandUnmatched = 0;
  for (const plan of plans) {
    // Only rows not yet linked (idempotent).
    const rows = (await db
      .select()
      .from(plan.table)
      .where(isNull(plan.fiscalPeriodColumn))) as Record<string, unknown>[];

    const updates: Array<{ id: number; periodId: number }> = [];
    const unmatched: string[] = [];
    for (const row of rows) {
      const key = plan.getKey(row);
      const periodId = plan.resolve(key, periodRows);
      if (periodId == null) {
        unmatched.push(key ?? "(null key)");
        continue;
      }
      updates.push({ id: Number(row.id), periodId });
    }

    if (!dryRun) {
      const CHUNK = 200;
      for (let i = 0; i < updates.length; i += CHUNK) {
        await Promise.all(
          updates.slice(i, i + CHUNK).map((u) =>
            db
              .update(plan.table)
              .set({ fiscalPeriodId: u.periodId })
              .where(and(eq(plan.idColumn, u.id), isNull(plan.fiscalPeriodColumn))),
          ),
        );
      }
    }

    grandUnmatched += unmatched.length;
    const status = unmatched.length === 0 ? "✓" : "✗";
    console.log(
      `${status} ${plan.label}: ${rows.length} unlinked · ${updates.length} ${
        dryRun ? "would link" : "linked"
      } · ${unmatched.length} unmatched`,
    );
    if (unmatched.length > 0) {
      const sample = Array.from(new Set(unmatched)).slice(0, 10);
      console.log(`    unmatched keys (sample): ${sample.join(", ")}`);
    }
  }

  console.log(
    `\n${grandUnmatched === 0 ? "✓ 100% matched." : `✗ ${grandUnmatched} row(s) unmatched — extend the fiscal calendar seed to cover their range.`}`,
  );
  if (grandUnmatched > 0) process.exitCode = 1;
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
