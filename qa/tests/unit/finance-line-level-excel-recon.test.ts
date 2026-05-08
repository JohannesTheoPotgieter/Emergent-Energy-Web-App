/**
 * R5 — Per-line reconciliation against Excel.
 *
 * Models a Mondi-shaped fixture spanning multiple categories and asserts
 * that the app's `perLineRevenue` matches Excel column U value-for-value
 * within R 1 for 10 named lines.
 *
 * The Excel column U formula on the source workbook is:
 *
 *     U = (Q / X) * J
 *
 * where:
 *   Q = the actual cost on the row (col Q)
 *   X = SUM(Q) within the same category on the project (col X on header row)
 *   J = the category's revenue allocation (col J on header row)
 *
 * The fixture below names 10 specific lines and computes the canonical
 * U value directly from the inputs; the test asserts the app derives the
 * identical number via `deriveFinanceLinesFromRows`. This proves the
 * line-level math is correct, not just the aggregate (per the prompt's
 * acceptance criterion #3).
 */
import { describe, it, expect } from "vitest";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const MONDI = 1;

/**
 * Mondi-shaped fixture — three categories spanning 10 named lines.
 *
 *   Cat 1 — Panels         J = R 60,000,000
 *     L01 Q = R 18,000,000   L02 Q = R  6,500,000
 *     L03 Q = R  2,500,000   L04 Q = R  3,000,000
 *
 *   Cat 2 — Inverters      J = R 25,000,000
 *     L05 Q = R 12,000,000   L06 Q = R  4,750,000
 *     L07 Q = R  3,250,000
 *
 *   Cat 3 — Mounting       J = R 18,000,000
 *     L08 Q = R  9,800,000   L09 Q = R  6,200,000
 *     L10 Q = R  4,000,000
 *
 *   Project totals:
 *     Σ Q  (cost)    = R  70,000,000
 *     Σ J  (revenue) = R 103,000,000
 *     Σ GP            = R  33,000,000   (≈ 32.04% margin)
 *
 *   Category X (denominator):
 *     Cat 1: 30,000,000     Cat 2: 20,000,000     Cat 3: 20,000,000
 */
const ALLOC_PANELS = 101;
const ALLOC_INVERTERS = 102;
const ALLOC_MOUNTING = 103;

const allocations: FinanceLineAllocationRowInput[] = [
  { id: ALLOC_PANELS, projectId: MONDI, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "60000000" },
  { id: ALLOC_INVERTERS, projectId: MONDI, categoryKey: "2. Inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "25000000" },
  { id: ALLOC_MOUNTING, projectId: MONDI, categoryKey: "3. Mounting", categoryName: "Mounting Structures", categoryNumber: "3", revenueAllocation: "18000000" },
];

interface NamedLine {
  name: string;
  parentId: number;
  actualId: number;
  actualTotal: number;
  invoiceRaisedDate: string;
  category: number;
  description: string;
}

const NAMED: NamedLine[] = [
  { name: "L01", parentId: 1, actualId: 1, actualTotal: 18000000, invoiceRaisedDate: "2026-04-15", category: ALLOC_PANELS, description: "1.1 Panels — supply" },
  { name: "L02", parentId: 2, actualId: 2, actualTotal: 6500000, invoiceRaisedDate: "2026-05-15", category: ALLOC_PANELS, description: "1.2 Panels — install" },
  { name: "L03", parentId: 3, actualId: 3, actualTotal: 2500000, invoiceRaisedDate: "2026-06-15", category: ALLOC_PANELS, description: "1.3 Panels — commissioning" },
  { name: "L04", parentId: 4, actualId: 4, actualTotal: 3000000, invoiceRaisedDate: "2026-07-15", category: ALLOC_PANELS, description: "1.4 Panels — handover" },
  { name: "L05", parentId: 5, actualId: 5, actualTotal: 12000000, invoiceRaisedDate: "2026-04-30", category: ALLOC_INVERTERS, description: "2.1 Inverters — supply" },
  { name: "L06", parentId: 6, actualId: 6, actualTotal: 4750000, invoiceRaisedDate: "2026-05-30", category: ALLOC_INVERTERS, description: "2.2 Inverters — install" },
  { name: "L07", parentId: 7, actualId: 7, actualTotal: 3250000, invoiceRaisedDate: "2026-06-30", category: ALLOC_INVERTERS, description: "2.3 Inverters — commissioning" },
  { name: "L08", parentId: 8, actualId: 8, actualTotal: 9800000, invoiceRaisedDate: "2026-04-20", category: ALLOC_MOUNTING, description: "3.1 Mounting — supply" },
  { name: "L09", parentId: 9, actualId: 9, actualTotal: 6200000, invoiceRaisedDate: "2026-05-20", category: ALLOC_MOUNTING, description: "3.2 Mounting — install" },
  { name: "L10", parentId: 10, actualId: 10, actualTotal: 4000000, invoiceRaisedDate: "2026-06-20", category: ALLOC_MOUNTING, description: "3.3 Mounting — fasteners" },
];

const CATEGORY_X: Record<number, number> = {
  [ALLOC_PANELS]: 30000000,
  [ALLOC_INVERTERS]: 20000000,
  [ALLOC_MOUNTING]: 20000000,
};

const CATEGORY_J: Record<number, number> = {
  [ALLOC_PANELS]: 60000000,
  [ALLOC_INVERTERS]: 25000000,
  [ALLOC_MOUNTING]: 18000000,
};

const parents: FinanceLineParentRowInput[] = NAMED.map((n) => ({
  id: n.parentId,
  projectId: MONDI,
  categoryAllocationId: n.category,
  categoryKey: allocations.find((a) => a.id === n.category)!.categoryKey,
  costCategory: allocations.find((a) => a.id === n.category)!.categoryName,
  description: n.description,
  budgetTotal: String(Math.round(n.actualTotal * 1.05)),
  forecastPaymentDate: n.invoiceRaisedDate,
  paidDate: null,
  paidDateConfirmed: null,
}));

const actuals: FinanceLineActualsRowInput[] = NAMED.map((n) => ({
  id: n.actualId,
  costLineId: n.parentId,
  projectId: MONDI,
  actualTotal: String(n.actualTotal),
  poNumber: `PO-${n.name}`,
  invoiceNumber: `INV-${n.name}`,
  invoiceDate: n.invoiceRaisedDate,
  financePaymentDate: null,
  description: n.description,
  qty: "1",
  rate: String(n.actualTotal),
}));

const excelU = (n: NamedLine): number =>
  (n.actualTotal / CATEGORY_X[n.category]) * CATEGORY_J[n.category];

describe("R5 — per-line reconciliation against Excel column U", () => {
  it("each of the 10 named lines matches Excel U = (Q/X)*J within R 1", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const byParent = new Map(lines.map((l) => [l.parentLineId, l]));

    for (const n of NAMED) {
      const line = byParent.get(n.parentId);
      expect(line, `line ${n.name} present`).toBeDefined();

      const expectedU = excelU(n);
      const expectedGp = expectedU - n.actualTotal;
      const expectedGpPct = expectedGp / expectedU;

      expect(line!.perLineRevenue).toBeCloseTo(expectedU, 0); // within R 1
      expect(line!.perLineGp).toBeCloseTo(expectedGp, 0);
      expect(line!.perLineGpPct ?? NaN).toBeCloseTo(expectedGpPct, 6);
      expect(line!.recognitionMonth).toBe(n.invoiceRaisedDate.slice(0, 7));
      expect(line!.categoryTotalActualTotal).toBe(CATEGORY_X[n.category]);
      expect(line!.categoryRevenueAllocation).toBe(CATEGORY_J[n.category]);
    }
  });

  it("project totals sum to the documented Mondi-shape grand totals", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const totalCos = lines.reduce((s, l) => s + l.actualTotal, 0);
    const totalRevenue = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    const totalGp = lines.reduce((s, l) => s + l.perLineGp, 0);

    expect(totalCos).toBe(70_000_000);
    expect(totalRevenue).toBeCloseTo(103_000_000, 0);
    expect(totalGp).toBeCloseTo(33_000_000, 0);
    expect(totalGp).toBeCloseTo(totalRevenue - totalCos, 0);
  });

  it("monthly aggregation = sum of line-level values (no category-edge rounding)", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);

    // Group lines by recognition month and sum.
    const byMonth = new Map<string, { cos: number; revenue: number; gp: number }>();
    for (const l of lines) {
      const m = l.recognitionMonth!;
      const row = byMonth.get(m) ?? { cos: 0, revenue: 0, gp: 0 };
      row.cos += l.actualTotal;
      row.revenue += l.perLineRevenue;
      row.gp += l.perLineGp;
      byMonth.set(m, row);
    }

    // Identity per month: GP = Revenue - COS within rounding.
    for (const [m, row] of byMonth) {
      expect(row.gp, `month ${m} identity`).toBeCloseTo(row.revenue - row.cos, 4);
    }

    // Sum of months equals project totals.
    const sumMonths = Array.from(byMonth.values()).reduce(
      (acc, r) => ({ cos: acc.cos + r.cos, revenue: acc.revenue + r.revenue, gp: acc.gp + r.gp }),
      { cos: 0, revenue: 0, gp: 0 },
    );
    expect(sumMonths.cos).toBe(70_000_000);
    expect(sumMonths.revenue).toBeCloseTo(103_000_000, 0);
    expect(sumMonths.gp).toBeCloseTo(33_000_000, 0);
  });
});
