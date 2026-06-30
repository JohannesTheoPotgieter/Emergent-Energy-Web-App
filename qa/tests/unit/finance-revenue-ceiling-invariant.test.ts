/**
 * Revenue-ceiling invariant — "derived/realised revenue cannot exceed the
 * project's contract (milestone-tracker) revenue."
 *
 * These tests pin the MECHANISM behind the Seshego Circle report (derived
 * revenue ~R12.43M vs a milestone-tracker Planned-Revenue-Actual of ~R10.43M)
 * against the frozen pure §3.3 helper `deriveFinanceLinesFromRows`. No DB.
 *
 * Two facts are proven:
 *   1. IDENTITY — for self-consistent data, a project's TOTAL derived revenue
 *      is identically Σ category_revenue_allocations.revenue_allocation (col J).
 *      The frozen formula does NOT inflate; it reproduces the costing sheet's
 *      revenue split exactly. ⇒ the only way derived revenue can exceed the
 *      contract is if the INPUT data says so.
 *   2. DUPLICATE-ALLOCATION inflation — `category_revenue_allocations` has no
 *      (project_id, category_key) uniqueness guard (unlike the *_row_hash
 *      unique indexes on revenue/cost lines). Two LIVE rows for one logical
 *      category, with parents split across them, double-count that category's
 *      J. This is the in-code path by which derived revenue can exceed the
 *      costing-defined total — and the thing the de-dup fix must close.
 *
 * Companion read-only prod audit: scripts/diagnose-revenue-vs-milestone.ts.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const PROJECT = 700;

function projectRevenueTotal(
  actuals: FinanceLineActualsRowInput[],
  parents: FinanceLineParentRowInput[],
  allocs: FinanceLineAllocationRowInput[],
): number {
  const lines = deriveFinanceLinesFromRows(actuals, parents, allocs);
  return aggregateLinesByMonth(lines).total.revenue;
}

describe("revenue-ceiling invariant (§3.3)", () => {
  it("IDENTITY: total derived revenue equals Σ revenue_allocation for self-consistent data", () => {
    const allocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: PROJECT, categoryKey: "1. panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "50000" },
      { id: 2, projectId: PROJECT, categoryKey: "2. inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "30000" },
    ];
    const parents: FinanceLineParentRowInput[] = [
      { id: 11, projectId: PROJECT, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "Panels", description: "panel supply", budgetTotal: "9000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 12, projectId: PROJECT, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "Panels", description: "panel install", budgetTotal: "13000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 13, projectId: PROJECT, categoryAllocationId: 2, categoryKey: "2. inverters", costCategory: "Inverters", description: "inverters", budgetTotal: "16000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
    ];
    const actuals: FinanceLineActualsRowInput[] = [
      { id: 101, costLineId: 11, projectId: PROJECT, actualTotal: "8000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-02-10", financePaymentDate: null, description: "panel supply", qty: null, rate: null },
      { id: 102, costLineId: 12, projectId: PROJECT, actualTotal: "12000", poNumber: null, invoiceNumber: "INV-2", invoiceDate: "2026-03-10", financePaymentDate: null, description: "panel install", qty: null, rate: null },
      { id: 103, costLineId: 13, projectId: PROJECT, actualTotal: "15000", poNumber: null, invoiceNumber: "INV-3", invoiceDate: "2026-03-12", financePaymentDate: null, description: "inverters", qty: null, rate: null },
    ];

    const sumJ = allocs.reduce((s, a) => s + Number(a.revenueAllocation), 0); // 80000
    const total = projectRevenueTotal(actuals, parents, allocs);

    // The whole point: the formula reproduces the costing-sheet J total exactly,
    // independent of how cost is distributed across lines within a category.
    expect(total).toBeCloseTo(sumJ, 2);
    expect(total).toBeCloseTo(80000, 2);
  });

  it("DUPLICATE allocations double-count a category — the in-code path that breaks the ceiling", () => {
    // One LOGICAL category "Panels" with a single, correct contract value of
    // R50,000 — but TWO live allocation rows survive (a re-import that failed to
    // soft-close the predecessor; there is no unique index to stop it). Their
    // keys differ just enough ("1. panels" vs "panels") that the S10 relink does
    // NOT collapse the parents onto one row, so each parent resolves to its own
    // allocation and the category's J is counted twice.
    const dupAllocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: PROJECT, categoryKey: "1. panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "50000" },
      { id: 2, projectId: PROJECT, categoryKey: "panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "50000" },
    ];
    const parents: FinanceLineParentRowInput[] = [
      { id: 11, projectId: PROJECT, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "Panels", description: "supply", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 12, projectId: PROJECT, categoryAllocationId: 2, categoryKey: "panels", costCategory: "Panels", description: "install", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
    ];
    const actuals: FinanceLineActualsRowInput[] = [
      { id: 101, costLineId: 11, projectId: PROJECT, actualTotal: "8000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-02-10", financePaymentDate: null, description: "supply", qty: null, rate: null },
      { id: 102, costLineId: 12, projectId: PROJECT, actualTotal: "12000", poNumber: null, invoiceNumber: "INV-2", invoiceDate: "2026-03-10", financePaymentDate: null, description: "install", qty: null, rate: null },
    ];

    const intendedContract = 50000;
    const total = projectRevenueTotal(actuals, parents, dupAllocs);

    // Demonstrates the violation: R100,000 derived against a R50,000 contract.
    expect(total).toBeCloseTo(100000, 2);
    expect(total).toBeGreaterThan(intendedContract);

    // And the control: with the duplicate removed (one live row per category),
    // the same lines derive exactly the contract value — proving the fix target.
    const cleanAllocs: FinanceLineAllocationRowInput[] = [dupAllocs[0]];
    const cleanParents = parents.map((p) => ({ ...p, categoryAllocationId: 1, categoryKey: "1. panels" }));
    const cleanTotal = projectRevenueTotal(actuals, cleanParents, cleanAllocs);
    expect(cleanTotal).toBeCloseTo(intendedContract, 2);
  });
});
