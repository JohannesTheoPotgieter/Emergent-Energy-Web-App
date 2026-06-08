/**
 * Reconciliation allocation fixture (fix/reconciliation-structural-allcause).
 *
 * Proves the §3.3 category-scoped (Q/X)×J derivation + the app-vs-tracker status
 * end-to-end on a real-shaped, correctly-allocated project ("Coega"):
 *
 *   - a correctly-allocated project: Σ derived revenue per category == J (the
 *     category revenue allocation) within R1, every line derives cleanly, and
 *     the project reconciles to GREEN / "ties" when the pasted tracker (col U)
 *     equals the formula;
 *   - an FK-stale-but-key-recoverable line still derives (the §3.3.2 fallback by
 *     (project, category_key)) → ties, NOT a false "unlinked";
 *   - a genuinely-unlinked line (no live allocation by FK OR key) surfaces as the
 *     honest "unlinked" status — NOT a misleading red "Structural".
 *
 * This is the regression guard for the diagnosed root cause: structural-red was
 * being raised for projects whose only issue is unlinked category allocations.
 */
import { describe, expect, it } from "vitest";

import {
  deriveFinanceLinesFromRows,
  type FinanceLine,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import {
  computeAppVsTrackerStatus,
  type ReconLineInput,
} from "../../../server/services/reconciliation-service";

const toReconLine = (l: FinanceLine): ReconLineInput => ({
  lineId: l.lineId,
  perLineRevenue: l.perLineRevenue,
  revenueStored: l.revenueStored,
  reconDelta: l.reconDelta,
  derivationWarning: l.derivationWarning,
});

// ── Coega: one category (J = R1,200,000), two cost lines summing to X = R1,000,000.
const COEGA_PROJECT = 100;
const coegaAllocations: FinanceLineAllocationRowInput[] = [
  {
    id: 1,
    projectId: COEGA_PROJECT,
    categoryKey: "1. Panels",
    categoryName: "Panels",
    categoryNumber: "1",
    revenueAllocation: "1200000", // J
    budgetTotal: "1000000",
  },
];
const coegaParents: FinanceLineParentRowInput[] = [
  {
    id: 10,
    projectId: COEGA_PROJECT,
    categoryAllocationId: 1,
    categoryKey: "1. Panels",
    costCategory: "Panels",
    description: "Panel supply",
    budgetTotal: "600000",
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
  },
  {
    id: 11,
    projectId: COEGA_PROJECT,
    categoryAllocationId: 1,
    categoryKey: "1. Panels",
    costCategory: "Panels",
    description: "Panel install",
    budgetTotal: "400000",
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
  },
];
// Tracker (pasted col U) equals the formula → ties. (Q/X)×J:
//   line 10: (600000/1000000)×1200000 = 720000
//   line 11: (400000/1000000)×1200000 = 480000
const coegaActuals: FinanceLineActualsRowInput[] = [
  {
    id: 1000,
    costLineId: 10,
    projectId: COEGA_PROJECT,
    actualTotal: "600000",
    poNumber: null,
    invoiceNumber: "INV-1",
    invoiceDate: "2025-09-15",
    financePaymentDate: null,
    description: "Panel supply",
    qty: null,
    rate: null,
    revenueRecognitionAmount: "720000",
  },
  {
    id: 1001,
    costLineId: 11,
    projectId: COEGA_PROJECT,
    actualTotal: "400000",
    poNumber: null,
    invoiceNumber: "INV-2",
    invoiceDate: "2025-09-20",
    financePaymentDate: null,
    description: "Panel install",
    qty: null,
    rate: null,
    revenueRecognitionAmount: "480000",
  },
];

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

describe("Coega — a correctly-allocated project derives §3.3 revenue and ties", () => {
  const lines = deriveFinanceLinesFromRows(coegaActuals, coegaParents, coegaAllocations);

  it("derives every line cleanly (no derivation warning)", () => {
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.derivationWarning).toBeNull();
  });

  it("category Σ derived revenue == J (the revenue allocation) within R1", () => {
    const sumDerived = sum(lines.map((l) => l.perLineRevenue));
    expect(Math.abs(sumDerived - 1_200_000)).toBeLessThanOrEqual(1);
    // The §3.3 GP identity must hold: Σ GP == Σ revenue − Σ COS.
    const sumGp = sum(lines.map((l) => l.perLineGp));
    const sumCos = sum(lines.map((l) => l.actualTotal));
    expect(Math.abs(sumGp - (sumDerived - sumCos))).toBeLessThanOrEqual(1);
  });

  it("reconciles to GREEN / ties when the pasted tracker equals the formula", () => {
    const result = computeAppVsTrackerStatus(lines.map(toReconLine));
    expect(result.status).toBe("green");
    expect(result.structuralLineIds).toHaveLength(0);
    expect(result.unlinkedLineIds).toHaveLength(0);
    expect(Math.abs(result.appVsTrackerDelta)).toBeLessThanOrEqual(1);
  });
});

describe("FK-stale but key-recoverable — the §3.3.2 fallback still derives (not unlinked)", () => {
  it("a parent whose categoryAllocationId points to a dead row recovers by (project, category_key)", () => {
    const parents: FinanceLineParentRowInput[] = [
      { ...coegaParents[0], categoryAllocationId: 999 }, // dead FK
      { ...coegaParents[1], categoryAllocationId: 999 }, // dead FK
    ];
    const lines = deriveFinanceLinesFromRows(coegaActuals, parents, coegaAllocations);
    for (const l of lines) expect(l.derivationWarning).toBeNull();
    expect(Math.abs(sum(lines.map((l) => l.perLineRevenue)) - 1_200_000)).toBeLessThanOrEqual(1);
    expect(computeAppVsTrackerStatus(lines.map(toReconLine)).status).toBe("green");
  });
});

describe("Genuinely unlinked — honest 'unlinked', never a misleading red", () => {
  it("a line with no live allocation (FK + key both miss) is 'unlinked', not 'red'", () => {
    const parents: FinanceLineParentRowInput[] = [
      {
        id: 20,
        projectId: 200,
        categoryAllocationId: null,
        categoryKey: null,
        costCategory: "Misc",
        description: "Unlinked line",
        budgetTotal: "50000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
      },
    ];
    const actuals: FinanceLineActualsRowInput[] = [
      {
        id: 2000,
        costLineId: 20,
        projectId: 200,
        actualTotal: "50000",
        poNumber: null,
        invoiceNumber: "INV-9",
        invoiceDate: "2025-09-15",
        financePaymentDate: null,
        description: "Unlinked line",
        qty: null,
        rate: null,
        revenueRecognitionAmount: "60000", // a pasted col-U the app cannot derive against
      },
    ];
    const lines = deriveFinanceLinesFromRows(actuals, parents, /* no allocations */ []);
    expect(lines).toHaveLength(1);
    expect(lines[0].perLineRevenue).toBe(0);
    expect(lines[0].derivationWarning).toBe("missing_category_allocation_linkage");

    const result = computeAppVsTrackerStatus(lines.map(toReconLine));
    expect(result.status).toBe("unlinked");
    expect(result.status).not.toBe("red");
    expect(result.unlinkedLineIds).toEqual([2000]);
    expect(result.reason).toMatch(/re-import/i);
  });
});
