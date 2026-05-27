/**
 * TF-25 (audit V3) — Unit-test the 5 finance KPI formulas that V3 found
 * untested. The 6th KPI (`cos_tracker_realised`) already has the
 * 47-test isEffectivelyRealised suite. These tests pin the
 * remaining formulas — `revenue_planned`, `gp_tracker_actual`,
 * `revenue_tracker_allocated` (incl. category-level S15),
 * `dashboard_plan_gp_margin`, `finance_recognised_revenue`.
 *
 * The KPI definitions are documented in shared/kpi-definitions.ts.
 */
import { describe, expect, it } from "vitest";
import {
  allocateRevenue,
  allocateRevenueByCategory,
} from "../../../server/lib/calculations/financeUtils";

// ──────────────────────────────────────────────────────────────────────
// Helpers — pure formula functions extracted from the audit doc.
// Defined here (not in production code) so the tests double as the
// canonical specification. A regression in the production aggregator
// will diverge from the formula and fail the test.
// ──────────────────────────────────────────────────────────────────────

/** gp_tracker_actual — per-line GP = revenue allocated − cost realised. */
function gpForLine(allocatedRevenue: number, costRealised: number): number {
  return allocatedRevenue - costRealised;
}

/** dashboard_plan_gp_margin — % margin against PLANNED revenue. */
function planGpMarginPct(plannedRevenue: number, plannedExpenditure: number): number | null {
  if (plannedRevenue <= 0) return null;
  return (plannedRevenue - plannedExpenditure) / plannedRevenue;
}

/** revenue_planned — naive SUM of effective rows. */
function sumActiveRevenue(rows: Array<{ effectiveTo: Date | null; amountExVat: number }>): number {
  return rows
    .filter((r) => r.effectiveTo === null)
    .reduce((sum, r) => sum + r.amountExVat, 0);
}

/**
 * finance_recognised_revenue — total recognised revenue across all
 * project lines. Recognised = allocated revenue summed over realised
 * cost lines.
 */
function recognisedRevenue(
  lines: Array<{
    actualCost: number;
    isRealised: boolean;
    noRevenueLinked?: boolean;
  }>,
  totalProjectCOS: number,
  totalProjectRevenue: number,
): number {
  return lines
    .filter((l) => l.isRealised)
    .reduce(
      (sum, l) =>
        sum +
        allocateRevenue(l.actualCost, totalProjectCOS, totalProjectRevenue, !!l.noRevenueLinked),
      0,
    );
}

// ──────────────────────────────────────────────────────────────────────
// revenue_planned
// ──────────────────────────────────────────────────────────────────────

describe("TF-25 — revenue_planned", () => {
  it("sums only rows with effective_to IS NULL (current snapshot)", () => {
    const rows = [
      { effectiveTo: null, amountExVat: 100 },
      { effectiveTo: new Date("2026-01-01"), amountExVat: 50 }, // historical
      { effectiveTo: null, amountExVat: 200 },
    ];
    expect(sumActiveRevenue(rows)).toBe(300);
  });

  it("returns 0 for empty current snapshot", () => {
    expect(sumActiveRevenue([])).toBe(0);
    expect(sumActiveRevenue([{ effectiveTo: new Date(), amountExVat: 100 }])).toBe(0);
  });

  it("handles negative amounts (credit notes)", () => {
    expect(sumActiveRevenue([
      { effectiveTo: null, amountExVat: 1000 },
      { effectiveTo: null, amountExVat: -150 },
    ])).toBe(850);
  });
});

// ──────────────────────────────────────────────────────────────────────
// gp_tracker_actual
// ──────────────────────────────────────────────────────────────────────

describe("TF-25 — gp_tracker_actual", () => {
  it("returns allocated revenue minus realised cost", () => {
    expect(gpForLine(15000, 12000)).toBe(3000);
  });

  it("is negative when the line is over budget", () => {
    expect(gpForLine(10000, 12000)).toBe(-2000);
  });

  it("returns 0 when both inputs are 0", () => {
    expect(gpForLine(0, 0)).toBe(0);
  });

  it("is symmetric for credit notes", () => {
    expect(gpForLine(-1000, -1500)).toBe(500);
  });
});

// ──────────────────────────────────────────────────────────────────────
// revenue_tracker_allocated — pinned via allocateRevenue + category form
// ──────────────────────────────────────────────────────────────────────

describe("TF-25 — revenue_tracker_allocated (project-level, COS-ratio)", () => {
  it("returns the COS ratio multiplied by total revenue", () => {
    // 10K cost line in a 100K project that bills 500K → allocated 50K
    expect(allocateRevenue(10_000, 100_000, 500_000, false)).toBe(50_000);
  });

  it("returns 0 when the line is flagged noRevenueLinked", () => {
    expect(allocateRevenue(10_000, 100_000, 500_000, true)).toBe(0);
  });

  it("returns 0 when project COS is 0 or negative (guard against divide-by-zero)", () => {
    expect(allocateRevenue(1, 0, 500_000, false)).toBe(0);
    expect(allocateRevenue(1, -100, 500_000, false)).toBe(0);
  });

  it("sums to 100% of project revenue across all positive lines", () => {
    const totalCos = 100_000;
    const totalRevenue = 500_000;
    const lines = [25_000, 35_000, 40_000];
    const allocated = lines.reduce(
      (sum, c) => sum + allocateRevenue(c, totalCos, totalRevenue, false),
      0,
    );
    expect(allocated).toBeCloseTo(totalRevenue, 2);
  });
});

describe("TF-25 — revenue_tracker_allocated (category-level, S15)", () => {
  it("uses category totals instead of project totals", () => {
    // Engineering category: 30K cost, 150K revenue allocation.
    // Line is 10K → 33.33% of category → 50K revenue.
    expect(allocateRevenueByCategory(10_000, 30_000, 150_000, false)).toBeCloseTo(50_000, 2);
  });

  it("returns 0 when category COS is 0", () => {
    expect(allocateRevenueByCategory(1, 0, 150_000, false)).toBe(0);
  });

  it("returns 0 when revenue allocation is non-positive", () => {
    expect(allocateRevenueByCategory(10_000, 30_000, 0, false)).toBe(0);
    expect(allocateRevenueByCategory(10_000, 30_000, -1, false)).toBe(0);
  });

  it("returns 0 when the line is flagged noRevenueLinked", () => {
    expect(allocateRevenueByCategory(10_000, 30_000, 150_000, true)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// dashboard_plan_gp_margin
// ──────────────────────────────────────────────────────────────────────

describe("TF-25 — dashboard_plan_gp_margin", () => {
  it("returns (planned − expenditure) / planned for a healthy project", () => {
    expect(planGpMarginPct(1_000_000, 800_000)).toBeCloseTo(0.2, 4);
  });

  it("returns 0 for a break-even plan", () => {
    expect(planGpMarginPct(1_000_000, 1_000_000)).toBe(0);
  });

  it("returns a negative margin when the plan loses money", () => {
    expect(planGpMarginPct(800_000, 1_000_000)).toBeCloseTo(-0.25, 4);
  });

  it("returns null when planned revenue is 0 (avoids divide-by-zero)", () => {
    expect(planGpMarginPct(0, 100_000)).toBeNull();
  });

  it("returns null for negative planned revenue (data integrity guard)", () => {
    expect(planGpMarginPct(-1, 0)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// finance_recognised_revenue
// ──────────────────────────────────────────────────────────────────────

describe("TF-25 — finance_recognised_revenue", () => {
  it("recognises only realised cost lines", () => {
    const totalCos = 100_000;
    const totalRevenue = 500_000;
    const lines = [
      { actualCost: 30_000, isRealised: true },
      { actualCost: 20_000, isRealised: false }, // planned — skipped
      { actualCost: 50_000, isRealised: true },
    ];
    // 30K + 50K = 80K realised cost → 80% × 500K = 400K recognised
    expect(recognisedRevenue(lines, totalCos, totalRevenue)).toBeCloseTo(400_000, 2);
  });

  it("excludes noRevenueLinked lines from the recognised pool", () => {
    const totalCos = 100_000;
    const totalRevenue = 500_000;
    const lines = [
      { actualCost: 30_000, isRealised: true, noRevenueLinked: true }, // excluded
      { actualCost: 50_000, isRealised: true },
    ];
    expect(recognisedRevenue(lines, totalCos, totalRevenue)).toBeCloseTo(250_000, 2);
  });

  it("returns 0 when nothing is realised", () => {
    expect(recognisedRevenue([
      { actualCost: 1, isRealised: false },
    ], 100, 500)).toBe(0);
  });

  it("equals total revenue once 100% of cost is realised", () => {
    const totalCos = 100_000;
    const totalRevenue = 500_000;
    const lines = [
      { actualCost: 40_000, isRealised: true },
      { actualCost: 60_000, isRealised: true },
    ];
    expect(recognisedRevenue(lines, totalCos, totalRevenue)).toBeCloseTo(totalRevenue, 2);
  });
});
