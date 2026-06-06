/**
 * Finance provenance / reconciliation — Coega tracker fixture.
 *
 * Acceptance (task step 4): for the Coega tracker fixture,
 *   SUM(revenue_derived) per category == category J (col J) within R1.
 *
 * `revenue_derived` is the canonical per-line POC value (AGENT_GUARDRAILS § 3.3):
 *   perLineRevenue = (line.actualTotal / category.totalActualTotal)
 *                    × category.revenueAllocation
 * Summed over a category, the actual_total terms collapse to the category total
 * (X), leaving exactly the category's revenue allocation (J). This test pins
 * that identity against both the canonical derivation
 * (deriveFinanceLinesFromRows) and the backfill's revenue_derived output
 * (computeProvenanceUpdates), so neither can drift from § 3.3.
 */

import { describe, expect, it } from "vitest";

import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import { computeProvenanceUpdates } from "../../../server/scripts/backfill-provenance";

const PROJECT_ID = 999;

function parent(
  id: number,
  categoryAllocationId: number,
  categoryKey: string,
): FinanceLineParentRowInput {
  return {
    id,
    projectId: PROJECT_ID,
    categoryAllocationId,
    categoryKey,
    costCategory: categoryKey,
    description: `cost line ${id}`,
    budgetTotal: null,
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
  };
}

function actual(
  id: number,
  costLineId: number,
  actualTotal: string,
): FinanceLineActualsRowInput {
  return {
    id,
    costLineId,
    projectId: PROJECT_ID,
    actualTotal,
    poNumber: null,
    invoiceNumber: `INV-${id}`,
    invoiceDate: "2026-01-15",
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
    financePaymentDate: null,
    description: `actual ${id}`,
    qty: null,
    rate: null,
    // revenue_recognition_amount (col U) intentionally absent so the derived
    // (Q/X)×J path is exercised — this is exactly what revenue_derived stores.
  };
}

// ─── Coega-style tracker fixture: two categories ───
// Category J (col J) is the known revenue allocation. The actuals' actual_total
// (col Q) within a category sum to the category total (col X).
const allocations: FinanceLineAllocationRowInput[] = [
  {
    id: 101,
    projectId: PROJECT_ID,
    categoryKey: "1. panels",
    categoryName: "Panels",
    categoryNumber: "1",
    revenueAllocation: "1000000.00",
  },
  {
    id: 102,
    projectId: PROJECT_ID,
    categoryKey: "2. mounting structure",
    categoryName: "Mounting Structure",
    categoryNumber: "2",
    revenueAllocation: "673630.88",
  },
];

const parents: FinanceLineParentRowInput[] = [
  parent(1, 101, "1. panels"),
  parent(2, 101, "1. panels"),
  parent(3, 102, "2. mounting structure"),
];

// Category 101 actuals (X = 1,000,000.00) · Category 102 actuals (X = 1,420,317.86)
const actuals: FinanceLineActualsRowInput[] = [
  actual(11, 1, "300000.00"),
  actual(12, 1, "200000.00"),
  actual(13, 2, "500000.00"),
  actual(14, 3, "1363577.86"),
  actual(15, 3, "56740.00"),
];

const categoryJ = new Map<number, number>([
  [101, 1000000],
  [102, 673630.88],
]);

const rowCategory = new Map<number, number>();
for (const a of actuals) {
  const p = parents.find((row) => row.id === a.costLineId);
  if (p?.categoryAllocationId != null) rowCategory.set(a.id, p.categoryAllocationId);
}

const R1 = 1; // R1.00 tolerance

describe("Finance provenance — Coega fixture revenue_derived reconciliation", () => {
  it("Σ canonical per-line revenue per category equals category J within R1", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    expect(lines).toHaveLength(actuals.length);

    const sumByCategory = new Map<number, number>();
    for (const line of lines) {
      if (line.categoryAllocationId == null) continue;
      sumByCategory.set(
        line.categoryAllocationId,
        (sumByCategory.get(line.categoryAllocationId) ?? 0) + line.perLineRevenue,
      );
    }

    expect(sumByCategory.size).toBe(categoryJ.size);
    for (const [categoryId, j] of categoryJ) {
      const sum = sumByCategory.get(categoryId) ?? 0;
      expect(Math.abs(sum - j)).toBeLessThanOrEqual(R1);
    }
  });

  it("Σ backfill revenue_derived per category equals category J within R1", () => {
    const updates = computeProvenanceUpdates(actuals, parents, allocations);
    expect(updates).toHaveLength(actuals.length);

    const sumByCategory = new Map<number, number>();
    for (const u of updates) {
      const categoryId = rowCategory.get(u.id);
      if (categoryId == null) continue;
      sumByCategory.set(
        categoryId,
        (sumByCategory.get(categoryId) ?? 0) + Number(u.revenueDerived),
      );
    }

    expect(sumByCategory.size).toBe(categoryJ.size);
    for (const [categoryId, j] of categoryJ) {
      const sum = sumByCategory.get(categoryId) ?? 0;
      expect(Math.abs(sum - j)).toBeLessThanOrEqual(R1);
    }
  });

  it("recon_delta = stored − derived, and is null when col U is absent", () => {
    const alloc: FinanceLineAllocationRowInput[] = [
      {
        id: 1,
        projectId: 1,
        categoryKey: "x",
        categoryName: "X",
        categoryNumber: "1",
        revenueAllocation: "500000.00",
      },
    ];
    const pars: FinanceLineParentRowInput[] = [parent(1, 1, "x")];
    pars[0].projectId = 1;
    const acts: FinanceLineActualsRowInput[] = [
      { ...actual(10, 1, "250000.00"), projectId: 1, revenueRecognitionAmount: "500001.00" },
      {
        ...actual(11, 1, "250000.00"),
        projectId: 1,
        invoiceNumber: null, // no invoice, no payment date → recognition_method null
        invoiceDateFontColor: null,
      },
    ];

    const updates = computeProvenanceUpdates(acts, pars, alloc);
    const byId = new Map(updates.map((u) => [u.id, u]));

    // X = 500,000 → each row derives 250000/500000 × 500000 = 250,000.
    expect(Number(byId.get(10)?.revenueDerived)).toBeCloseTo(250000, 2);
    expect(byId.get(10)?.revenueStored).toBe("500001.00");
    expect(Number(byId.get(10)?.reconDelta)).toBeCloseTo(250001, 2);
    expect(byId.get(10)?.recognitionMethod).toBe("true_invoice");

    expect(byId.get(11)?.revenueStored).toBeNull();
    expect(byId.get(11)?.reconDelta).toBeNull();
    expect(byId.get(11)?.recognitionMethod).toBeNull();
  });
});
