/**
 * FYE per-month / per-state / per-project breakdown.
 *
 * This is the single Realised/Committed/Planned/Unrealised source the
 * standalone Revenue / COS / GP tabs are being re-sourced onto, so the tabs
 * reconcile to the FYE Tracking Report exactly. The breakdown MUST classify
 * each line identically to the FYE state engine (classifyFyeState) and
 * aggregate per state + per project. These tests pin that contract.
 */

import { describe, it, expect } from "vitest";
import { computeMonthlyStateBreakdown } from "../../../server/lib/finance/fye-tracking/compute";
import type { FinanceLine } from "../../../server/repositories/finance-line-level-repository";

const MONTHS = ["2025-09", "2025-10", "2026-06"];
const TODAY = "2026-06-04";

function line(partial: Partial<FinanceLine>): FinanceLine {
  return {
    projectId: 1,
    recognitionMonth: "2025-09",
    invoiceNumber: null,
    invoiceDateFontColor: null,
    invoiceDateConfirmed: null,
    invoiceRaisedDate: null,
    perLineRevenue: 0,
    actualTotal: 0,
    ...partial,
  } as unknown as FinanceLine;
}

describe("computeMonthlyStateBreakdown", () => {
  it("invoice + black => realised; invoice + red => committed (rev + cos + per-project)", () => {
    const lines = [
      line({ recognitionMonth: "2025-09", invoiceNumber: "INV-1", invoiceDateFontColor: "black", perLineRevenue: 100, actualTotal: 80 }),
      line({ recognitionMonth: "2025-09", invoiceNumber: "INV-2", invoiceDateFontColor: "red", perLineRevenue: 50, actualTotal: 40 }),
    ];
    const sep = computeMonthlyStateBreakdown(lines, MONTHS, TODAY, () => "Alpha").find((r) => r.monthKey === "2025-09")!;
    expect(sep.revenue.realised.total).toBe(100);
    expect(sep.cos.realised.total).toBe(80);
    expect(sep.revenue.committed.total).toBe(50);
    expect(sep.cos.committed.total).toBe(40);
    expect(sep.revenue.realised.projects.get("Alpha")).toBe(100);
  });

  it("placeholder invoice does NOT count as a real invoice", () => {
    const lines = [
      line({ recognitionMonth: "2025-09", invoiceNumber: "TBC", invoiceDateFontColor: "black", perLineRevenue: 70, actualTotal: 60 }),
    ];
    const sep = computeMonthlyStateBreakdown(lines, MONTHS, TODAY, () => "Alpha").find((r) => r.monthKey === "2025-09")!;
    expect(sep.revenue.realised.total).toBe(0); // not realised — placeholder invoice
    expect(sep.revenue.unrealised.total).toBe(70);
  });

  it("no invoice + future red => planned; no invoice otherwise => unrealised", () => {
    const lines = [
      line({ recognitionMonth: "2026-06", invoiceDateFontColor: "red", invoiceRaisedDate: "2026-07-15", perLineRevenue: 30, actualTotal: 20 }),
      line({ recognitionMonth: "2026-06", perLineRevenue: 10, actualTotal: 5 }),
    ];
    const jun = computeMonthlyStateBreakdown(lines, MONTHS, TODAY, () => "Beta").find((r) => r.monthKey === "2026-06")!;
    expect(jun.revenue.planned.total).toBe(30);
    expect(jun.revenue.unrealised.total).toBe(10);
  });

  it("one zero-filled row per FY month, in order; out-of-window lines ignored", () => {
    const out = computeMonthlyStateBreakdown([line({ recognitionMonth: "2030-01", perLineRevenue: 999 })], MONTHS, TODAY, () => "X");
    expect(out.map((r) => r.monthKey)).toEqual(MONTHS);
    expect(out.every((r) => r.revenue.realised.total === 0 && r.cos.realised.total === 0)).toBe(true);
  });

  it("aggregates multiple projects within a state", () => {
    const lines = [
      line({ recognitionMonth: "2025-10", projectId: 1, invoiceNumber: "A", invoiceDateConfirmed: true, perLineRevenue: 100, actualTotal: 70 }),
      line({ recognitionMonth: "2025-10", projectId: 2, invoiceNumber: "B", invoiceDateConfirmed: true, perLineRevenue: 40, actualTotal: 25 }),
    ];
    const oct = computeMonthlyStateBreakdown(lines, MONTHS, TODAY, (pid) => (pid === 1 ? "Alpha" : "Beta")).find((r) => r.monthKey === "2025-10")!;
    expect(oct.revenue.realised.total).toBe(140);
    expect(oct.revenue.realised.projects.get("Alpha")).toBe(100);
    expect(oct.revenue.realised.projects.get("Beta")).toBe(40);
  });
});
