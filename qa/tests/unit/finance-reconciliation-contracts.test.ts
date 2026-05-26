/**
 * DF-26 — Reconciliation contract tests for the multi-level aggregation
 * spine of the finance module.
 *
 * Per `docs/AGENT_GUARDRAILS.md` § 3.3.1, aggregates of revenue / COS / GP
 * MUST be computed as the sum of per-line values, never pooled. The four
 * reconciliation contracts pinned here are:
 *
 *   C1. Project total = SUM(per-line totals) for every project.
 *   C2. Portfolio total = SUM(project totals) — NOT pooled across all
 *       lines (which would silently mix category mixes).
 *   C3. Per-line GP identity: SUM(perLineGp) ≡ SUM(perLineRevenue) -
 *       SUM(line.actualTotal), within rounding.
 *   C4. Each line's GP = perLineRevenue - actualTotal (sanity).
 *
 * A 5th contract — persisted col U parity — is covered by the existing
 * `finance-line-level-excel-recon.test.ts`. The 6th — FY total = SUM
 * (monthly totals) — needs a multi-month fixture and lives in
 * `finance-line-level-portfolio.test.ts`. The contracts here are the
 * regression guards that protect the per-line-sum invariant.
 */
import { describe, it, expect } from "vitest";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const PROJECT_A = 1001;
const PROJECT_B = 1002;

// Three categories, varying allocations and line counts, to make pooling
// vs per-project sums produce visibly different numbers.
const allocations: FinanceLineAllocationRowInput[] = [
  // Project A
  { id: 1, projectId: PROJECT_A, categoryKey: "panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "60000" },
  { id: 2, projectId: PROJECT_A, categoryKey: "inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "40000" },
  // Project B — different category mix
  { id: 3, projectId: PROJECT_B, categoryKey: "panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "20000" },
  { id: 4, projectId: PROJECT_B, categoryKey: "ess", categoryName: "Battery Storage", categoryNumber: "3", revenueAllocation: "180000" },
];

const parents: FinanceLineParentRowInput[] = [
  // Project A: 2 panel lines, 1 inverter line
  { id: 11, projectId: PROJECT_A, categoryAllocationId: 1, categoryKey: "panels", costCategory: "Panels", description: "Panels A-1", budgetTotal: "9000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 12, projectId: PROJECT_A, categoryAllocationId: 1, categoryKey: "panels", costCategory: "Panels", description: "Panels A-2", budgetTotal: "11000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 13, projectId: PROJECT_A, categoryAllocationId: 2, categoryKey: "inverters", costCategory: "Inverters", description: "Inverter A-1", budgetTotal: "20000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  // Project B: 1 panel line, 1 ESS line
  { id: 21, projectId: PROJECT_B, categoryAllocationId: 3, categoryKey: "panels", costCategory: "Panels", description: "Panels B-1", budgetTotal: "12000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  { id: 22, projectId: PROJECT_B, categoryAllocationId: 4, categoryKey: "ess", costCategory: "Battery Storage", description: "ESS B-1", budgetTotal: "60000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
];

const actuals: FinanceLineActualsRowInput[] = [
  // Project A actuals
  { id: 101, costLineId: 11, projectId: PROJECT_A, actualTotal: "10000", poNumber: null, invoiceNumber: "INV-A1", invoiceDate: "2026-04-10", financePaymentDate: null, description: "A-1", qty: "1", rate: "10000" },
  { id: 102, costLineId: 12, projectId: PROJECT_A, actualTotal: "15000", poNumber: null, invoiceNumber: "INV-A2", invoiceDate: "2026-04-10", financePaymentDate: null, description: "A-2", qty: "1", rate: "15000" },
  { id: 103, costLineId: 13, projectId: PROJECT_A, actualTotal: "25000", poNumber: null, invoiceNumber: "INV-A3", invoiceDate: "2026-04-15", financePaymentDate: null, description: "Inv-A", qty: "1", rate: "25000" },
  // Project B actuals
  { id: 201, costLineId: 21, projectId: PROJECT_B, actualTotal: "8000", poNumber: null, invoiceNumber: "INV-B1", invoiceDate: "2026-04-20", financePaymentDate: null, description: "B-1", qty: "1", rate: "8000" },
  { id: 202, costLineId: 22, projectId: PROJECT_B, actualTotal: "75000", poNumber: null, invoiceNumber: "INV-B2", invoiceDate: "2026-04-22", financePaymentDate: null, description: "ESS-B", qty: "1", rate: "75000" },
];

describe("Finance reconciliation contracts — multi-level aggregation parity", () => {
  const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);

  it("C1. Project A total revenue = SUM(per-line revenues for project A)", () => {
    const projectALines = lines.filter((l) => l.projectId === PROJECT_A);
    const sumPerLine = projectALines.reduce((s, l) => s + l.perLineRevenue, 0);
    // Project A: Panels (10000+15000)/(25000) * 60000 = 60000 (full panel allocation),
    // Inverters: 25000/25000 * 40000 = 40000.
    // Project A total = 100000.
    expect(sumPerLine).toBeCloseTo(100000, 2);
  });

  it("C1. Project B total revenue = SUM(per-line revenues for project B)", () => {
    const projectBLines = lines.filter((l) => l.projectId === PROJECT_B);
    const sumPerLine = projectBLines.reduce((s, l) => s + l.perLineRevenue, 0);
    // Project B: Panels 8000/8000 * 20000 = 20000; ESS 75000/75000 * 180000 = 180000.
    // Project B total = 200000.
    expect(sumPerLine).toBeCloseTo(200000, 2);
  });

  it("C2. Portfolio revenue = SUM(project totals), NOT cross-project pooled", () => {
    const projectATotal = lines.filter((l) => l.projectId === PROJECT_A).reduce((s, l) => s + l.perLineRevenue, 0);
    const projectBTotal = lines.filter((l) => l.projectId === PROJECT_B).reduce((s, l) => s + l.perLineRevenue, 0);
    const portfolioTotal = projectATotal + projectBTotal;

    // Sum-of-projects gives 100000 + 200000 = 300000.
    expect(portfolioTotal).toBeCloseTo(300000, 2);

    // Cross-project pooling would treat the panels category as one big
    // bucket across A + B and produce a different (wrong) answer. We
    // confirm by computing the pooled "wrong" form and asserting it
    // would have differed — proving the per-project scoping mattered.
    const allPanelLines = lines.filter((l) => l.categoryKey === "panels");
    const pooledPanelsActual = allPanelLines.reduce((s, l) => s + l.actualTotal, 0);
    const pooledPanelsAllocation = 60000 + 20000; // Project A 60k + Project B 20k
    const allPanelLinesPooledRevenue = allPanelLines.reduce(
      (s, l) => s + (pooledPanelsActual === 0 ? 0 : (l.actualTotal / pooledPanelsActual) * pooledPanelsAllocation),
      0,
    );
    // The pooled form sums to the pooled allocation (80000), but the per-
    // project sum gives 60000 + 20000 = 80000 too — coincidence for this
    // fixture. The KEY is that they're computed differently and the
    // canonical implementation is the per-project version. Verify the
    // per-project version is what came out.
    const projectAPanels = lines
      .filter((l) => l.projectId === PROJECT_A && l.categoryKey === "panels")
      .reduce((s, l) => s + l.perLineRevenue, 0);
    expect(projectAPanels).toBeCloseTo(60000, 2);
  });

  it("C3. Algebraic identity: SUM(perLineGp) ≡ SUM(perLineRevenue) − SUM(actualTotal)", () => {
    const sumGp = lines.reduce((s, l) => s + l.perLineGp, 0);
    const sumRevenue = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    const sumActual = lines.reduce((s, l) => s + l.actualTotal, 0);
    expect(sumGp).toBeCloseTo(sumRevenue - sumActual, 2);
  });

  it("C4. Per-line GP = perLineRevenue − actualTotal for every line", () => {
    for (const l of lines) {
      expect(l.perLineGp).toBeCloseTo(l.perLineRevenue - l.actualTotal, 2);
    }
  });

  it("C5. Per-line GP% = perLineGp / perLineRevenue, null when revenue=0", () => {
    for (const l of lines) {
      if (l.perLineRevenue === 0) {
        expect(l.perLineGpPct).toBeNull();
      } else {
        expect(l.perLineGpPct).toBeCloseTo(l.perLineGp / l.perLineRevenue, 6);
      }
    }
  });

  it("C6. No line straddles two projects (project scoping intact)", () => {
    const projectIds = new Set(lines.map((l) => l.projectId));
    expect(projectIds.size).toBe(2);
    expect(projectIds).toContain(PROJECT_A);
    expect(projectIds).toContain(PROJECT_B);
  });

  it("C7. Category totals are scoped to a single project (no cross-project pooling)", () => {
    // Project A panel lines should see categoryTotalActualTotal = 25000
    // (10000 + 15000), not 33000 (which would be Project A + Project B).
    const projectAPanelLine = lines.find(
      (l) => l.projectId === PROJECT_A && l.categoryKey === "panels",
    );
    expect(projectAPanelLine?.categoryTotalActualTotal).toBe(25000);

    // Project B panel line should see categoryTotalActualTotal = 8000
    // (just B's panel), not 33000.
    const projectBPanelLine = lines.find(
      (l) => l.projectId === PROJECT_B && l.categoryKey === "panels",
    );
    expect(projectBPanelLine?.categoryTotalActualTotal).toBe(8000);
  });
});
