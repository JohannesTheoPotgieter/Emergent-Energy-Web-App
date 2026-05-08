/**
 * R4 — performance ceiling for the line-level derivation pipeline.
 *
 * The repository's `getProjectFinanceLines` and
 * `getPortfolioFinanceLines` use three batched queries plus an
 * in-memory pass; no N+1 per line. This test exercises the in-memory
 * pass at scale via the pure helper `deriveFinanceLinesFromRows`,
 * which is the part that runs per request once the data is loaded.
 *
 * Targets (from the original prompt):
 *   - Single project (~500 lines): < 500ms total. The DB-side cost is
 *     dominated by 3 queries; the math is microseconds. We assert the
 *     math budget at < 50ms to leave 450ms headroom for the DB.
 *   - 65-project portfolio (~30k lines): < 2s total. We assert the
 *     math budget at < 500ms to leave 1.5s headroom.
 *
 * If a future "optimisation" introduces a quadratic path inside
 * `deriveFinanceLinesFromRows` (e.g. a per-line allocation lookup
 * via `.find()` on an array, or a per-line category scan), this test
 * fires before the regression hits production.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

interface SyntheticData {
  actuals: FinanceLineActualsRowInput[];
  parents: FinanceLineParentRowInput[];
  allocations: FinanceLineAllocationRowInput[];
}

/**
 * Generate a synthetic finance dataset of given shape:
 *   - `projectCount` projects
 *   - each project has `categoryCount` categories
 *   - each category has `linesPerCategory` parent rows + 1 actuals child each
 *
 * The total line count is `projectCount × categoryCount × linesPerCategory`.
 */
function makeSyntheticDataset(
  projectCount: number,
  categoryCount: number,
  linesPerCategory: number,
): SyntheticData {
  const actuals: FinanceLineActualsRowInput[] = [];
  const parents: FinanceLineParentRowInput[] = [];
  const allocations: FinanceLineAllocationRowInput[] = [];

  let allocId = 1;
  let parentId = 1;
  let actualId = 1;
  for (let p = 1; p <= projectCount; p++) {
    for (let c = 1; c <= categoryCount; c++) {
      const aId = allocId++;
      allocations.push({
        id: aId,
        projectId: p,
        categoryKey: `${c}. cat-${c}`,
        categoryName: `Category ${c}`,
        categoryNumber: String(c),
        revenueAllocation: String(1_000_000 * c),
      });
      for (let l = 0; l < linesPerCategory; l++) {
        const pid = parentId++;
        parents.push({
          id: pid,
          projectId: p,
          categoryAllocationId: aId,
          categoryKey: `${c}. cat-${c}`,
          costCategory: `Category ${c}`,
          description: `line-${pid}`,
          budgetTotal: "100000",
          forecastPaymentDate: "2026-04-15",
          paidDate: null,
          paidDateConfirmed: null,
        });
        // Spread invoice dates across 12 months so monthly bucketing
        // exercises a realistic distribution.
        const month = (l % 12) + 1;
        actuals.push({
          id: actualId++,
          costLineId: pid,
          projectId: p,
          actualTotal: String(80_000 + (l % 10) * 1_000),
          poNumber: `PO-${pid}`,
          invoiceNumber: `INV-${pid}`,
          invoiceDate: `2026-${String(month).padStart(2, "0")}-15`,
          financePaymentDate: null,
          description: null,
          qty: "1",
          rate: null,
        });
      }
    }
  }
  return { actuals, parents, allocations };
}

const measure = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("R4 — single-project budget (~500 lines, <50ms math)", () => {
  it("derives 500 lines (5 cats × 100 lines/cat) under the budget", () => {
    const { actuals, parents, allocations } = makeSyntheticDataset(1, 5, 100);
    expect(actuals).toHaveLength(500);

    // Warm-up — first run pays for JIT and Map allocations.
    deriveFinanceLinesFromRows(actuals, parents, allocations);

    const elapsed = measure(() => {
      const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
      const agg = aggregateLinesByMonth(lines);
      // Force the result to not be optimised away.
      expect(lines).toHaveLength(500);
      expect(agg.total.count).toBe(500);
    });
    expect(elapsed).toBeLessThan(50);
  });
});

describe("R4 — 65-project portfolio budget (~30k lines, <500ms math)", () => {
  it("derives ~30k lines (65 projects × 8 cats × 60 lines/cat) under the budget", () => {
    const { actuals, parents, allocations } = makeSyntheticDataset(65, 8, 60);
    expect(actuals).toHaveLength(65 * 8 * 60); // 31,200

    deriveFinanceLinesFromRows(actuals, parents, allocations);

    const elapsed = measure(() => {
      const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
      const agg = aggregateLinesByMonth(lines);
      expect(lines).toHaveLength(31_200);
      // Each line is one of 12 months → 12 monthly buckets.
      expect(agg.byMonth.length).toBeGreaterThanOrEqual(12);
    });
    expect(elapsed).toBeLessThan(500);
  });

  it("portfolio sum identity holds at scale: Σ projects = portfolio total", () => {
    // Smaller fixture for the algebraic identity check.
    const { actuals, parents, allocations } = makeSyntheticDataset(10, 4, 50);
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const totalRevenue = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    const totalGp = lines.reduce((s, l) => s + l.perLineGp, 0);
    const totalCos = lines.reduce((s, l) => s + l.actualTotal, 0);

    const byProject = new Map<number, number>();
    for (const l of lines) {
      byProject.set(l.projectId, (byProject.get(l.projectId) ?? 0) + l.perLineRevenue);
    }
    const sumOfProjects = Array.from(byProject.values()).reduce((s, v) => s + v, 0);
    expect(sumOfProjects).toBeCloseTo(totalRevenue, 2);
    expect(totalGp).toBeCloseTo(totalRevenue - totalCos, 2);
  });
});
