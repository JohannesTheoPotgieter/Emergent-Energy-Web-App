import { describe, expect, it } from "vitest";
import {
  buildFinanceStrictRows,
  buildSourceAuthorityBadges,
  buildWorkflowExceptions,
} from "../../client/src/lib/project-detail-command-centre";

describe("Project Detail command centre helpers", () => {
  it("builds strict finance rows from supplied endpoint values without redefining finance rules", () => {
    const rows = buildFinanceStrictRows({
      canViewFinance: true,
      plannedRevenue: 1_000_000,
      committedCost: 250_000,
      invoicedRevenue: 600_000,
      paidReceived: 400_000,
      realisedRevenuePct: 40,
      realisedCosPct: 25,
      outstandingRevenue: 600_000,
      atRiskCount: 3,
    });

    expect(rows.map((row) => row.key)).toEqual([
      "planned",
      "committed",
      "invoiced",
      "paid-received",
      "realised",
      "outstanding",
      "at-risk",
    ]);
    expect(rows[0]).toMatchObject({
      value: "R 1 000 000",
      sourceAuthority: "Excel/App contract summary",
      editable: false,
    });
    expect(rows[3]).toMatchObject({
      value: "R 400 000",
      sourceAuthority: "Receipt/payment date",
      formula: "Endpoint value supplied to Project Detail; receipt date drives revenue realisation where defined.",
    });
    expect(rows[4].formula).toContain("COS realised only from invoice actuals");
  });

  it("masks strict finance rows when finance permission is missing", () => {
    const rows = buildFinanceStrictRows({
      canViewFinance: false,
      plannedRevenue: 1_000_000,
      committedCost: 250_000,
      invoicedRevenue: 600_000,
      paidReceived: 400_000,
      realisedRevenuePct: 40,
      realisedCosPct: 25,
      outstandingRevenue: 600_000,
      atRiskCount: 3,
    });

    expect(rows.every((row) => row.value === "Restricted")).toBe(true);
    expect(rows.every((row) => row.tone === "restricted")).toBe(true);
  });

  it("builds compact source authority badges with missing import metadata as a warning", () => {
    const badges = buildSourceAuthorityBadges({
      importLineage: {
        latestImport: null,
        freshness: {
          state: "missing",
          daysSinceImport: null,
          warning: "No committed tracker import found",
        },
      },
      canViewFinance: true,
      canViewQuality: true,
      canViewDocuments: true,
      financeDriftStatus: "attention",
    });

    expect(badges.map((badge) => badge.key)).toEqual([
      "excel",
      "app",
      "quickbooks",
      "sharepoint",
      "pipedrive",
    ]);
    expect(badges[0]).toMatchObject({
      label: "Excel",
      detail: "No committed tracker import found",
      readOnly: true,
      tone: "warning",
    });
    expect(badges[2]).toMatchObject({
      label: "QuickBooks",
      detail: "attention",
      tone: "warning",
    });
  });

  it("prioritises workflow exceptions above routine status", () => {
    const exceptions = buildWorkflowExceptions({
      overduePlanTasks: 2,
      overdueEngineeringTasks: 0,
      pendingQualityApprovals: 3,
      overdueSupplierCosts: 1,
      missingImport: true,
      handoverBlocked: true,
    });

    expect(exceptions.map((item) => item.key)).toEqual([
      "missing-import",
      "handover-blocked",
      "pending-quality-approvals",
      "overdue-plan-tasks",
      "overdue-supplier-costs",
    ]);
  });
});
