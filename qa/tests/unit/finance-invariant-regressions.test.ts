/**
 * M2 — finance invariant regression guards.
 *
 * Pins the three defect classes surfaced in the finance audit, against the
 * frozen pure §3.3 helpers (no DB):
 *   1. IDENTITY / ceiling — total derived revenue ≡ Σ revenue_allocation, so
 *      a project's derived revenue is exactly the Costing sheet's col-J total.
 *      (H1: it can exceed the milestone contract only if the DATA says so.)
 *   2. DUPLICATE-allocation inflation — two live allocations for one logical
 *      category double-count it. (H3: the fix target.)
 *   3. NEGATIVE-month — a negative-cost line yields negative revenue that sums
 *      into the month with no floor. (H2: pins the mechanism so a future change
 *      is a conscious one.)
 */
import { describe, it, expect } from "vitest";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const P = 900;

const total = (
  a: FinanceLineActualsRowInput[],
  p: FinanceLineParentRowInput[],
  c: FinanceLineAllocationRowInput[],
) => aggregateLinesByMonth(deriveFinanceLinesFromRows(a, p, c)).total;

const alloc = (
  id: number,
  key: string,
  rev: string,
): FinanceLineAllocationRowInput => ({
  id,
  projectId: P,
  categoryKey: key,
  categoryName: key,
  categoryNumber: String(id),
  revenueAllocation: rev,
});
const parent = (
  id: number,
  allocId: number,
  key: string,
): FinanceLineParentRowInput => ({
  id,
  projectId: P,
  categoryAllocationId: allocId,
  categoryKey: key,
  costCategory: key,
  description: key,
  budgetTotal: null,
  forecastPaymentDate: null,
  paidDate: null,
  paidDateConfirmed: null,
});
const actual = (
  id: number,
  costLineId: number,
  amount: string,
  date: string,
): FinanceLineActualsRowInput => ({
  id,
  costLineId,
  projectId: P,
  actualTotal: amount,
  poNumber: null,
  invoiceNumber: `INV-${id}`,
  invoiceDate: date,
  financePaymentDate: null,
  description: null,
  qty: null,
  rate: null,
});

describe("finance invariant regressions (M2)", () => {
  it("1. IDENTITY: total derived revenue equals Σ revenue_allocation (col J)", () => {
    const allocs = [alloc(1, "1. panels", "50000"), alloc(2, "2. inverters", "30000")];
    const parents = [parent(11, 1, "1. panels"), parent(12, 1, "1. panels"), parent(13, 2, "2. inverters")];
    const actuals = [
      actual(101, 11, "8000", "2026-02-10"),
      actual(102, 12, "12000", "2026-03-10"),
      actual(103, 13, "15000", "2026-03-12"),
    ];
    expect(total(actuals, parents, allocs).revenue).toBeCloseTo(80000, 2);
  });

  it("2. DUPLICATE allocations double-count a category (fix target)", () => {
    // One logical "Panels" (R50k) split across two live allocation rows whose
    // keys differ just enough that the relink can't collapse them.
    const dup = [alloc(1, "1. panels", "50000"), alloc(2, "panels", "50000")];
    const parents = [parent(11, 1, "1. panels"), parent(12, 2, "panels")];
    const actuals = [actual(101, 11, "8000", "2026-02-10"), actual(102, 12, "12000", "2026-03-10")];
    expect(total(actuals, parents, dup).revenue).toBeCloseTo(100000, 2); // vs R50k intended

    // De-duped (one live row) → exactly the contract value.
    const clean = [dup[0]];
    const cleanParents = parents.map((p) => ({ ...p, categoryAllocationId: 1, categoryKey: "1. panels" }));
    expect(total(actuals, cleanParents, clean).revenue).toBeCloseTo(50000, 2);
  });

  it("3. NEGATIVE-month: a credit line drives a month's revenue negative, unfloored", () => {
    // Panels category net-positive overall, but a large negative-cost line
    // (credit note) dated Feb-26 recognises negative revenue in Feb-26.
    const allocs = [alloc(1, "1. panels", "1000000")];
    const parents = [parent(11, 1, "1. panels"), parent(12, 1, "1. panels")];
    const actuals = [
      actual(101, 11, "1000000", "2026-01-15"), // positive, Jan
      actual(102, 12, "-400000", "2026-02-15"), // credit note, Feb
    ];
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocs);
    const byMonth = aggregateLinesByMonth(lines).byMonth;
    const feb = byMonth.find((m) => m.monthKey === "2026-02");
    expect(feb).toBeDefined();
    // Category total actual = 600000; Feb line = (-400000/600000)*1,000,000 < 0.
    expect(feb!.revenue).toBeLessThan(0);
    // Documented invariant: there is NO floor at zero (H2). If this changes,
    // it must be a deliberate owner decision, not an accident.
  });
});
