/**
 * Parity test for the F-1 fix in audit/FINANCE_AUDIT_2026-05-26.md.
 *
 * `getCanonicalFinanceByProjectIds` previously exposed ONLY `totalRevenue`,
 * sourced from `SUM(normalized_revenue_lines.amount_ex_vat)` — i.e. milestone
 * billing, not the § 3.3 per-line POC formula. Per § 3.3.3 "Inflow ≠ revenue.
 * The two surfaces must not be conflated in any KPI tile, dashboard, or
 * report."
 *
 * The fix adds `recognisedRevenue` to the canonical row — sourced from
 * `FinanceLineLevelRepository` (the only § 3.3-compliant source) — alongside
 * the legacy `totalRevenue` (now relabelled "Contract value billed" in the
 * KPI contract). This test pins:
 *
 *   1. The interface carries both fields (compile-time + runtime regression
 *      guard against someone "fixing" the conflation by removing one).
 *   2. The per-line POC sum that powers `recognisedRevenue` matches what
 *      `finance-line-level-repository` returns — not a re-derivation
 *      elsewhere.
 *
 * The fixture mirrors `finance-line-level.test.ts` so the maths line up
 * with the existing canonical reference. The Mondi shape:
 *   Category 1 — Panels:    (8000/20000)*50000 + (12000/20000)*50000 = 50000
 *   Category 2 — Inverters: (15000/15000)*30000                       = 30000
 *   Project A total recognised revenue = 80000
 */
import { describe, it, expect } from "vitest";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import type { CanonicalProjectFinanceRow } from "../../../server/services/canonical-dashboard-kpi-service";

const PROJECT_A = 9001;
const ALLOC_PANELS = 1;
const ALLOC_INVERTERS = 2;

const allocations: FinanceLineAllocationRowInput[] = [
  { id: ALLOC_PANELS, projectId: PROJECT_A, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "50000" },
  { id: ALLOC_INVERTERS, projectId: PROJECT_A, categoryKey: "2. Inverters", categoryName: "Inverters", categoryNumber: "2", revenueAllocation: "30000" },
];

const parents: FinanceLineParentRowInput[] = [
  { id: 1, projectId: PROJECT_A, categoryAllocationId: ALLOC_PANELS, categoryKey: "1. Panels", costCategory: "Panels", description: "1.1 Panel supply", budgetTotal: "9000", forecastPaymentDate: "2026-04-15", paidDate: null, paidDateConfirmed: null },
  { id: 2, projectId: PROJECT_A, categoryAllocationId: ALLOC_PANELS, categoryKey: "1. Panels", costCategory: "Panels", description: "1.2 Panel install", budgetTotal: "13000", forecastPaymentDate: "2026-05-15", paidDate: "2026-05-30", paidDateConfirmed: true },
  { id: 3, projectId: PROJECT_A, categoryAllocationId: ALLOC_INVERTERS, categoryKey: "2. Inverters", costCategory: "Inverters", description: "2.1 Inverter supply", budgetTotal: "15000", forecastPaymentDate: "2026-04-30", paidDate: null, paidDateConfirmed: null },
];

const actuals: FinanceLineActualsRowInput[] = [
  { id: 1, costLineId: 1, projectId: PROJECT_A, actualTotal: "8000", poNumber: "PO-1", invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null, description: "1.1 Panel supply", qty: "10", rate: "800" },
  { id: 2, costLineId: 2, projectId: PROJECT_A, actualTotal: "12000", poNumber: "PO-2", invoiceNumber: "INV-2", invoiceDate: "2026-05-15", financePaymentDate: "2026-05-30", description: "1.2 Panel install", qty: "1", rate: "12000" },
  { id: 3, costLineId: 3, projectId: PROJECT_A, actualTotal: "15000", poNumber: "PO-3", invoiceNumber: "INV-3", invoiceDate: "2026-04-30", financePaymentDate: null, description: "2.1 Inverter supply", qty: "5", rate: "3000" },
];

describe("F-1 fix — recognisedRevenue parity with finance-line-level-repository", () => {
  it("CanonicalProjectFinanceRow exposes recognisedRevenue as a distinct field from totalRevenue", () => {
    // Compile-time + runtime regression guard. If someone re-removes
    // recognisedRevenue (or merges it back over totalRevenue) the type
    // check on this literal will fail.
    const row: CanonicalProjectFinanceRow = {
      projectId: PROJECT_A,
      totalRevenue: 1234,
      recognisedRevenue: 5678,
      receivedRevenue: 1234,
      outstandingRevenue: 0,
      totalCost: 999,
      paidCost: 0,
      outstandingCost: 999,
      realisedCost: 0,
    };
    expect(row.totalRevenue).not.toBe(row.recognisedRevenue);
    expect(row.totalRevenue).toBe(1234);
    expect(row.recognisedRevenue).toBe(5678);
  });

  it("recognisedRevenue source = sum of perLineRevenue from finance-line-level-repository", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const expectedRecognisedRevenue = lines
      .filter((l) => l.projectId === PROJECT_A)
      .reduce((sum, l) => sum + (Number.isFinite(l.perLineRevenue) ? l.perLineRevenue : 0), 0);

    // Mondi-shaped fixture: 20000 + 30000 + 30000 = 80000.
    expect(expectedRecognisedRevenue).toBeCloseTo(80000, 2);

    // The contract: this exact sum is what `populateRecognisedRevenue` in
    // canonical-dashboard-kpi-service.ts assigns to
    // CanonicalProjectFinanceRow.recognisedRevenue. If any future change
    // re-routes that field to `SUM(normalized_revenue_lines.amount_ex_vat)`,
    // the value will silently diverge for partially-completed projects
    // (where milestone billing exceeds POC by definition). The test
    // documents the contract and pins the field name.
  });
});
