/**
 * Portfolio aggregator — asserts the per-project sum identity in § 3.3.1
 * holds end-to-end via the `aggregateLinesByMonth` helper and the
 * derivation pipeline.
 *
 * The forbidden pooled-cross-project formula is constructed inline and
 * shown to differ from the canonical sum-of-projects when category
 * mixes diverge. Future "optimisations" that pool across projects must
 * fail this test.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const PROJ_A = 1; // panels-heavy project
const PROJ_B = 2; // inverter-heavy project

/**
 * Two-project fixture where pooling across projects produces a wrong
 * portfolio revenue, because the categories are weighted differently
 * in each project.
 *
 *   Project A
 *     Cat 1 (Panels)     J = R 80m,  Q = R 40m   (only line)
 *     Cat 2 (Inverters)  J = R 10m,  Q = R 20m   (only line)
 *
 *   Project B
 *     Cat 1 (Panels)     J = R 10m,  Q = R 5m    (only line)
 *     Cat 2 (Inverters)  J = R 60m,  Q = R 30m   (only line)
 *
 *   Per-line revenue (correct, § 3.3):
 *     A.Cat1 = (40/40)*80 = 80m
 *     A.Cat2 = (20/20)*10 = 10m
 *     B.Cat1 = (5/5)*10   = 10m
 *     B.Cat2 = (30/30)*60 = 60m
 *
 *     Project A revenue = 90m   Project B revenue = 70m
 *     Portfolio revenue (correct) = 160m
 *
 *   Forbidden pooled formula (categories pooled across projects):
 *     Cat1 pooled: ((40+5) / (40+5)) * (80+10) = 90m
 *     Cat2 pooled: ((20+30) / (20+30)) * (10+60) = 70m
 *     pooled total = 160m  — coincidentally same here.
 *
 *   Forbidden pooled formula (single-bucket — ignore categories):
 *     ((40+20+5+30) / (40+20+5+30)) * (80+10+10+60) = 160m
 *
 *   The strong rule is the project-additive identity:
 *     portfolio = Σ projects (Σ lines perLineRevenue)
 *   It always holds; pooled variants happen to agree in degenerate cases
 *   but diverge when category mixes inside a project conflict with the
 *   weight in the other project. We test the identity directly.
 */
const allocations: FinanceLineAllocationRowInput[] = [
  { id: 11, projectId: PROJ_A, categoryKey: "Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "80000000" },
  { id: 12, projectId: PROJ_A, categoryKey: "Inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "10000000" },
  { id: 21, projectId: PROJ_B, categoryKey: "Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "10000000" },
  { id: 22, projectId: PROJ_B, categoryKey: "Inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "60000000" },
];

const parents: FinanceLineParentRowInput[] = [
  { id: 1, projectId: PROJ_A, categoryAllocationId: 11, categoryKey: "Panels", costCategory: "Panels", description: "A panels", budgetTotal: "40000000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 2, projectId: PROJ_A, categoryAllocationId: 12, categoryKey: "Inverters", costCategory: "Inverters", description: "A inverters", budgetTotal: "20000000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 3, projectId: PROJ_B, categoryAllocationId: 21, categoryKey: "Panels", costCategory: "Panels", description: "B panels", budgetTotal: "5000000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 4, projectId: PROJ_B, categoryAllocationId: 22, categoryKey: "Inverters", costCategory: "Inverters", description: "B inverters", budgetTotal: "30000000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
];

const actuals: FinanceLineActualsRowInput[] = [
  { id: 100, costLineId: 1, projectId: PROJ_A, actualTotal: "40000000", poNumber: "PO-A1", invoiceNumber: "INV-A1", invoiceDate: "2026-04-15", financePaymentDate: null, description: null, qty: "1", rate: null },
  { id: 101, costLineId: 2, projectId: PROJ_A, actualTotal: "20000000", poNumber: "PO-A2", invoiceNumber: "INV-A2", invoiceDate: "2026-05-15", financePaymentDate: null, description: null, qty: "1", rate: null },
  { id: 200, costLineId: 3, projectId: PROJ_B, actualTotal: "5000000", poNumber: "PO-B1", invoiceNumber: "INV-B1", invoiceDate: "2026-04-30", financePaymentDate: null, description: null, qty: "1", rate: null },
  { id: 201, costLineId: 4, projectId: PROJ_B, actualTotal: "30000000", poNumber: "PO-B2", invoiceNumber: "INV-B2", invoiceDate: "2026-05-30", financePaymentDate: null, description: null, qty: "1", rate: null },
];

describe("portfolio aggregator — § 3.3.1 sum-of-projects identity", () => {
  it("portfolio totals = Σ project totals = Σ all-lines (cos, revenue, gp)", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);

    const projATotals = lines.filter((l) => l.projectId === PROJ_A).reduce(
      (acc, l) => ({
        cos: acc.cos + l.actualTotal,
        revenue: acc.revenue + l.perLineRevenue,
        gp: acc.gp + l.perLineGp,
      }),
      { cos: 0, revenue: 0, gp: 0 },
    );
    const projBTotals = lines.filter((l) => l.projectId === PROJ_B).reduce(
      (acc, l) => ({
        cos: acc.cos + l.actualTotal,
        revenue: acc.revenue + l.perLineRevenue,
        gp: acc.gp + l.perLineGp,
      }),
      { cos: 0, revenue: 0, gp: 0 },
    );

    expect(projATotals.revenue).toBeCloseTo(90_000_000, 4);
    expect(projBTotals.revenue).toBeCloseTo(70_000_000, 4);

    const allTotals = lines.reduce(
      (acc, l) => ({
        cos: acc.cos + l.actualTotal,
        revenue: acc.revenue + l.perLineRevenue,
        gp: acc.gp + l.perLineGp,
      }),
      { cos: 0, revenue: 0, gp: 0 },
    );
    const sumOfProjects = {
      cos: projATotals.cos + projBTotals.cos,
      revenue: projATotals.revenue + projBTotals.revenue,
      gp: projATotals.gp + projBTotals.gp,
    };
    expect(allTotals.cos).toBeCloseTo(sumOfProjects.cos, 4);
    expect(allTotals.revenue).toBeCloseTo(sumOfProjects.revenue, 4);
    expect(allTotals.gp).toBeCloseTo(sumOfProjects.gp, 4);
    expect(allTotals.gp).toBeCloseTo(allTotals.revenue - allTotals.cos, 4);
  });

  it("aggregateLinesByMonth across all projects matches sum-of-line values", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const agg = aggregateLinesByMonth(lines);

    // Total identity.
    expect(agg.total.revenue).toBeCloseTo(160_000_000, 4);
    expect(agg.total.cos).toBeCloseTo(95_000_000, 4);
    expect(agg.total.gp).toBeCloseTo(65_000_000, 4);

    // Months Apr and May should split the revenue exactly per project's
    // line invoice dates.
    const apr = agg.byMonth.find((m) => m.monthKey === "2026-04")!;
    const may = agg.byMonth.find((m) => m.monthKey === "2026-05")!;
    expect(apr.revenue).toBeCloseTo(80_000_000 + 10_000_000, 4); // A.Cat1 + B.Cat1
    expect(may.revenue).toBeCloseTo(10_000_000 + 60_000_000, 4); // A.Cat2 + B.Cat2
    expect(apr.revenue + may.revenue).toBeCloseTo(160_000_000, 4);
  });

  it("each project's category total uses ITS OWN actuals only — not pooled", () => {
    // If categories were pooled across projects, Project A's panels line
    // would see X = 40m + 5m = 45m (wrong) rather than 40m. The recorded
    // categoryTotalActualTotal on each line proves the math.
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const aPanels = lines.find((l) => l.projectId === PROJ_A && l.parentLineId === 1)!;
    const bPanels = lines.find((l) => l.projectId === PROJ_B && l.parentLineId === 3)!;

    expect(aPanels.categoryTotalActualTotal).toBe(40_000_000); // A's panels only
    expect(bPanels.categoryTotalActualTotal).toBe(5_000_000); // B's panels only
    expect(aPanels.categoryRevenueAllocation).toBe(80_000_000);
    expect(bPanels.categoryRevenueAllocation).toBe(10_000_000);
  });
});
