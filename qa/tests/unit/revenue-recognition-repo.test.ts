/**
 * P2.1c — repository-backed revenue helper.
 *
 * Proves the canonical replacement for the legacy col-U revenue readers:
 *   planned  = Σ perLineRevenue (all lines)
 *   realised = Σ perLineRevenue where bucket === "realised"
 * folded both purely (explicit buckets) and against the real § 3.3 derivation
 * (deriveFinanceLinesFromRows), so the tile totals are tied to the formula the
 * app now reports.
 */

import { describe, expect, it } from "vitest";

import {
  sumRepoRevenue,
  sumRepoRevenueByProject,
} from "../../../server/lib/finance/revenue-recognition-repo";
import {
  deriveFinanceLinesFromRows,
  type FinanceLine,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

type LiteLine = Pick<FinanceLine, "projectId" | "perLineRevenue" | "bucket">;

describe("P2.1c — sumRepoRevenue (pure fold)", () => {
  const lines: LiteLine[] = [
    { projectId: 1, perLineRevenue: 600_000, bucket: "realised" },
    { projectId: 1, perLineRevenue: 400_000, bucket: "planned" },
    { projectId: 2, perLineRevenue: 250_000, bucket: "committed" },
    { projectId: 2, perLineRevenue: 50_000, bucket: "realised" },
  ];

  it("planned = Σ all; realised = Σ realised-bucket only", () => {
    const { planned, realised } = sumRepoRevenue(lines);
    expect(planned).toBe(1_300_000); // 600k + 400k + 250k + 50k
    expect(realised).toBe(650_000); // 600k + 50k
  });

  it("groups planned/realised per project (no cross-project pooling)", () => {
    const byProject = sumRepoRevenueByProject(lines);
    expect(byProject.get(1)).toEqual({ planned: 1_000_000, realised: 600_000 });
    expect(byProject.get(2)).toEqual({ planned: 300_000, realised: 50_000 });
  });

  it("empty input → zeroes", () => {
    expect(sumRepoRevenue([])).toEqual({ planned: 0, realised: 0 });
    expect(sumRepoRevenueByProject([]).size).toBe(0);
  });
});

describe("P2.1c — integration with the § 3.3 formula", () => {
  const P = 5151;
  const allocations: FinanceLineAllocationRowInput[] = [
    { id: 1, projectId: P, categoryKey: "1. panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "1000000.00" },
  ];
  const parents: FinanceLineParentRowInput[] = [
    { id: 1, projectId: P, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "1. panels", description: "A", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
    { id: 2, projectId: P, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "1. panels", description: "B", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
  ];
  // X = 1,000,000 → A derives 600k, B derives 400k. A is realised (invoice +
  // BLACK + confirmed, safely-past date); B has no invoice → planned.
  const actuals: FinanceLineActualsRowInput[] = [
    { id: 11, costLineId: 1, projectId: P, actualTotal: "600000.00", poNumber: null, invoiceNumber: "INV-A", invoiceDate: "2025-01-15", invoiceDateFontColor: "black", invoiceDateConfirmed: true, financePaymentDate: null, description: "A", qty: null, rate: null },
    { id: 12, costLineId: 2, projectId: P, actualTotal: "400000.00", poNumber: null, invoiceNumber: null, invoiceDate: null, invoiceDateFontColor: null, invoiceDateConfirmed: null, financePaymentDate: null, description: "B", qty: null, rate: null },
  ];

  it("planned = Σ formula (= J); realised counts only the realised line", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const { planned, realised } = sumRepoRevenue(lines);

    // Σ formula over the category collapses to J.
    expect(planned).toBeCloseTo(1_000_000, 2);
    // Only line A (invoice + BLACK + confirmed, past date) is realised.
    const realisedLineIds = lines.filter((l) => l.bucket === "realised").map((l) => l.lineId);
    expect(realisedLineIds).toEqual([11]);
    expect(realised).toBeCloseTo(600_000, 2);
  });
});
