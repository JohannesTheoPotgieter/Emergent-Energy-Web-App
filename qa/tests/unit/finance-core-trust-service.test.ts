import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(),
}));
vi.mock("../../../server/db", () => ({
  db: { execute },
}));

import { buildFinanceCoreTrustReport } from "../../../server/services/finance-core-trust-service";

describe("finance core trust service", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns trust gap severities from reconciliation snapshots", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ active_rows: 10, missing_source_lineage: 2 }] }) // cost
      .mockResolvedValueOnce({ rows: [{ active_rows: 11, missing_source_lineage: 0 }] }) // revenue
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // invoice without po
      .mockResolvedValueOnce({ rows: [{ compared_rows: 8, mismatched_rows: 1 }] }); // drift

    const report = await buildFinanceCoreTrustReport();

    expect(report.classifications.some((entry) => entry.name === "normalized_cost_lines")).toBe(true);
    expect(report.reconciliationChecks.canonicalTotals.activeCostRows).toBe(10);
    expect(report.reconciliationChecks.lineageCoverage.costMissingSource).toBe(2);
    expect(report.reconciliationChecks.cosMonthlyVsCanonical.mismatchedRows).toBe(1);

    const invoiceGap = report.trustGaps.find((gap) => gap.key === "invoice_without_po");
    expect(invoiceGap?.severity).toBe("high");

    const routeGap = report.trustGaps.find((gap) => gap.key === "route_fragmentation");
    expect(routeGap?.count).toBeGreaterThan(1);
    expect(report.reconciliationChecks.routeSurface.financeTruthRoutes).toContain("/api/finance/revenue");
  });
});
