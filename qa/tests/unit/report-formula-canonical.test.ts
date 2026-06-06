/**
 * P2.1b — report revenue from the canonical formula, col U is a cross-check only.
 *
 * Pins the cutover in finance-line-level-repository.ts (the § 3.3.2 single read
 * path): `perLineRevenue` (the REPORTED figure) is ALWAYS the strict § 3.3
 * category-scoped (Q/X)×J formula. The pasted Excel col-U value
 * (`revenue_recognition_amount`) is exposed as `revenueStored` for the
 * reconciliation board (P2.2) but is NEVER reported, and `reconDelta`
 * (= revenueStored − perLineRevenue) is the stored-vs-derived delta the board
 * surfaces.
 *
 * Before this cutover the read path PREFERRED col U when present, so a stale
 * paste was reported verbatim. The change to reported revenue/GP is exactly the
 * P2.1 exposure (derived − reported) measured in
 * qa/reports/derived-vs-stored-exposure.csv.
 */

import { describe, expect, it } from "vitest";

import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const P = 7777;

function parent(
  id: number,
  categoryAllocationId: number | null,
  categoryKey: string | null,
): FinanceLineParentRowInput {
  return {
    id,
    projectId: P,
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
  colU: string | null,
): FinanceLineActualsRowInput {
  return {
    id,
    costLineId,
    projectId: P,
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
    revenueRecognitionAmount: colU,
  };
}

describe("P2.1b — reported revenue = § 3.3 formula, col U is reconciliation-only", () => {
  // One category, J = R1,000,000, X (Σ col Q) = R1,000,000.
  const allocations: FinanceLineAllocationRowInput[] = [
    { id: 1, projectId: P, categoryKey: "1. panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "1000000.00" },
  ];
  const parents: FinanceLineParentRowInput[] = [parent(1, 1, "1. panels"), parent(2, 1, "1. panels")];
  // Line A carries a STALE col U (700k) that disagrees with the 600k formula.
  // Line B carries no col U.
  const actuals: FinanceLineActualsRowInput[] = [
    actual(11, 1, "600000.00", "700000.00"),
    actual(12, 2, "400000.00", null),
  ];

  it("reports the formula value, NOT the stale pasted col U", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const a = lines.find((l) => l.lineId === 11)!;

    // Reported = formula (600k), not the stale paste (700k).
    expect(a.perLineRevenue).toBeCloseTo(600_000, 2);
    expect(a.perLineRevenue).not.toBeCloseTo(700_000, 2);
    expect(a.perLineGp).toBeCloseTo(0, 2); // 600k − 600k cost

    // col U is preserved as a reconciliation cross-check, never reported.
    expect(a.revenueStored).toBeCloseTo(700_000, 2);
    expect(a.reconDelta).toBeCloseTo(100_000, 2); // stored − derived (P2.1 sign)
    expect(a.derivationWarning).toBeNull();
  });

  it("category Σ reported revenue now equals J (col J) — the formula identity", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const sum = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    // Formula sums to J (1,000,000). The OLD col-U-preference path would have
    // summed 700k + 400k = 1,100,000 ≠ J.
    expect(sum).toBeCloseTo(1_000_000, 2);
  });

  it("lines without a pasted col U report the formula and expose null cross-check", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const b = lines.find((l) => l.lineId === 12)!;
    expect(b.perLineRevenue).toBeCloseTo(400_000, 2);
    expect(b.revenueStored).toBeNull();
    expect(b.reconDelta).toBeNull();
  });

  it("the reported change equals the P2.1 exposure (derived − reported = −reconDelta)", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const a = lines.find((l) => l.lineId === 11)!;
    // Old reported = stored (700k); new reported = formula (600k).
    const oldReported = a.revenueStored!;
    const newReported = a.perLineRevenue;
    const reportedChange = newReported - oldReported; // what this PR moves
    const exposureDelta = -a.reconDelta!; // P2.1 measured derived − reported
    expect(reportedChange).toBeCloseTo(exposureDelta, 2);
    expect(reportedChange).toBeCloseTo(-100_000, 2);
  });

  it("§ 3.3 edge case: missing allocation → 0 + warning, never the stale col U, never silent GP=-cost", () => {
    // Parent has a category key/FK but no matching active allocation, and the
    // actuals row still carries a col U paste. Old behaviour would have reported
    // the 50k paste; the cutover reports 0 + a warning instead.
    const alloc: FinanceLineAllocationRowInput[] = [];
    const pars: FinanceLineParentRowInput[] = [parent(9, 999, "9. orphan")];
    const acts: FinanceLineActualsRowInput[] = [actual(91, 9, "30000.00", "50000.00")];

    const lines = deriveFinanceLinesFromRows(acts, pars, alloc);
    const l = lines.find((x) => x.lineId === 91)!;

    expect(l.perLineRevenue).toBe(0); // NOT the 50k paste
    expect(l.derivationWarning).toBe("category_revenue_allocation_missing");
    // The pasted value is still surfaced for reconciliation…
    expect(l.revenueStored).toBeCloseTo(50_000, 2);
    expect(l.reconDelta).toBeCloseTo(50_000, 2); // 50k − 0
    // …and GP is -cost mathematically, but the warning is what the page renders
    // (badge), so it is NOT a SILENT GP = -cost.
    expect(l.perLineGp).toBeCloseTo(-30_000, 2);
    expect(l.derivationWarning).not.toBeNull();
  });
});
