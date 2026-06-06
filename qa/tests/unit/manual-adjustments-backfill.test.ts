/**
 * Manual-adjustments COPY backfill — parity.
 *
 * Acceptance (task step 4): copied row counts and summed values match each
 * source within R1. The backfill maps each *_manual source row into one or more
 * manual_adjustments drafts; this test feeds representative source rows + an
 * FY26/FY27 calendar to the pure mappers and asserts, per source, that the
 * draft count and the summed value match the source.
 */

import { describe, expect, it } from "vitest";

import {
  mapAvailablePaymentOverrides,
  mapCashflowWeeklyManual,
  mapFyeRevisedBudgetMonthly,
  mapOpexWeeklyManual,
  mapTrackerMonthlyManual,
  type FiscalPeriodRow,
  type ManualAdjustmentDraft,
} from "../../../server/scripts/backfill-manual-adjustments";

function buildFyPeriods(startId: number, fyStartYear: number, fyStartMonth1: number): FiscalPeriodRow[] {
  const periods: FiscalPeriodRow[] = [];
  for (let i = 0; i < 12; i++) {
    const start = new Date(Date.UTC(fyStartYear, fyStartMonth1 - 1 + i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    periods.push({ id: startId + i, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
  }
  return periods;
}
const periods: FiscalPeriodRow[] = [...buildFyPeriods(1, 2025, 9), ...buildFyPeriods(13, 2026, 9)];

const R1 = 1;
const sumValues = (drafts: ManualAdjustmentDraft[]) =>
  drafts.reduce((acc, d) => acc + (d.value == null ? 0 : Number(d.value)), 0);

describe("Manual-adjustments COPY backfill — parity per source", () => {
  it("tracker_monthly_manual fans out per populated metric; count + Σ value match", () => {
    const rows = [
      { trackerType: "revenue", monthKey: "2026-01", realised: "100.00", outstanding: "50.00", budget: "200.00", projectInfoId: 42 },
      { trackerType: "cos", monthKey: "2026-02", realised: "300.00", outstanding: null, budget: "400.00", projectInfoId: null },
    ];
    const drafts = mapTrackerMonthlyManual(rows, periods);

    // 3 metrics on row1 + 2 on row2 (outstanding null skipped) = 5 drafts.
    expect(drafts).toHaveLength(5);
    const sourceSum = 100 + 50 + 200 + 300 + 400;
    expect(Math.abs(sumValues(drafts) - sourceSum)).toBeLessThanOrEqual(R1);

    // scope follows projectInfoId; type encodes trackerType + metric.
    const row1 = drafts.filter((d) => d.adjustmentType.startsWith("tracker_revenue_"));
    expect(row1.every((d) => d.scope === "project" && d.projectId === 42)).toBe(true);
    expect(drafts.some((d) => d.adjustmentType === "tracker_cos_budget" && d.scope === "program")).toBe(true);
    // null outstanding on row2 is not copied
    expect(drafts.some((d) => d.adjustmentType === "tracker_cos_outstanding")).toBe(false);
    expect(drafts.every((d) => d.fiscalPeriodId !== null)).toBe(true);
  });

  it("cashflow_weekly_manual copies 1:1; count + Σ value match", () => {
    const rows = [
      { weekStartDate: "2026-01-05", openingBalance: "1000.00" },
      { weekStartDate: "2026-03-12", openingBalance: "2000.00" },
    ];
    const drafts = mapCashflowWeeklyManual(rows, periods);
    expect(drafts).toHaveLength(rows.length);
    expect(Math.abs(sumValues(drafts) - 3000)).toBeLessThanOrEqual(R1);
    expect(drafts.every((d) => d.scope === "program" && d.adjustmentType === "cashflow_opening_balance" && d.fiscalPeriodId !== null)).toBe(true);
  });

  it("opex_weekly_manual copies 1:1 with scope=opex; count + Σ value match", () => {
    const rows = [
      { weekStartDate: "2026-04-06", opexAmount: "500.00" },
      { weekStartDate: "2026-05-04", opexAmount: "700.00" },
    ];
    const drafts = mapOpexWeeklyManual(rows, periods);
    expect(drafts).toHaveLength(rows.length);
    expect(Math.abs(sumValues(drafts) - 1200)).toBeLessThanOrEqual(R1);
    expect(drafts.every((d) => d.scope === "opex" && d.adjustmentType === "opex_weekly" && d.fiscalPeriodId !== null)).toBe(true);
  });

  it("available_payment_overrides copies 1:1 and preserves/falls-back reason", () => {
    const rows = [
      { weekStartDate: "2026-06-01", overrideValue: "250.00", reason: "holiday shutdown" },
      { weekStartDate: "2026-07-06", overrideValue: "350.00", reason: null },
    ];
    const drafts = mapAvailablePaymentOverrides(rows, periods);
    expect(drafts).toHaveLength(rows.length);
    expect(Math.abs(sumValues(drafts) - 600)).toBeLessThanOrEqual(R1);
    expect(drafts[0].reason).toBe("holiday shutdown");
    expect(drafts[1].reason).toBe("Backfilled from available_payment_overrides");
    expect(drafts.every((d) => d.scope === "program" && d.fiscalPeriodId !== null)).toBe(true);
  });

  it("fye_revised_budget_monthly copies 1:1; type encodes metric; count + Σ value match", () => {
    const rows = [
      { fye: 2026, metric: "revenue", monthKey: "2025-09", amount: "10000.00" },
      { fye: 2026, metric: "cos", monthKey: "2025-09", amount: "6000.00" },
      { fye: 2026, metric: "gp", monthKey: "2025-09", amount: "4000.00" },
    ];
    const drafts = mapFyeRevisedBudgetMonthly(rows, periods);
    expect(drafts).toHaveLength(rows.length);
    expect(Math.abs(sumValues(drafts) - 20000)).toBeLessThanOrEqual(R1);
    expect(drafts.map((d) => d.adjustmentType)).toEqual([
      "fye_revised_revenue", "fye_revised_cos", "fye_revised_gp",
    ]);
    expect(drafts.every((d) => d.scope === "program" && d.fiscalPeriodId !== null)).toBe(true);
  });

  it("every copied draft satisfies the schema contract (reason NOT NULL, scope valid)", () => {
    const all = [
      ...mapTrackerMonthlyManual([{ trackerType: "revenue", monthKey: "2026-01", realised: "1.00", outstanding: "2.00", budget: "3.00", projectInfoId: null }], periods),
      ...mapCashflowWeeklyManual([{ weekStartDate: "2026-01-05", openingBalance: "1.00" }], periods),
      ...mapOpexWeeklyManual([{ weekStartDate: "2026-01-05", opexAmount: "1.00" }], periods),
      ...mapAvailablePaymentOverrides([{ weekStartDate: "2026-01-05", overrideValue: "1.00", reason: null }], periods),
      ...mapFyeRevisedBudgetMonthly([{ fye: 2026, metric: "gp", monthKey: "2026-01", amount: "1.00" }], periods),
    ];
    for (const d of all) {
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(0);
      expect(["project", "program", "opex"]).toContain(d.scope);
    }
  });
});
