import { describe, expect, it } from "vitest";
import { computeProjectHeaderKpis } from "../../../server/services/project-header-kpi-service";

function baseInput() {
  return {
    projectId: 101,
    contractValue: 1_000_000,
    canonicalRevenueRows: [] as any[],
    canonicalCostRows: [] as any[],
    derivedGrossMarginPct: 0,
    budgetBaselineMarginPct: null,
    executionBaselineMarginPct: null,
    summaryBaselineMarginPct: null,
    currentStageCode: null,
    executionNextRequiredAction: null,
    stageRows: [] as any[],
    stageDefinitions: [
      { stageCode: "S01_FIRST_ASSESSMENT", stageSequence: 1 },
      { stageCode: "S02_DESIGN_COST_PROPOSAL", stageSequence: 2 },
      { stageCode: "S03_SIGNATURE_FINANCIAL_CLOSE", stageSequence: 3 },
    ],
  };
}

describe("project header KPI canonical aggregator", () => {
  it("uses canonical normalized revenue/cost when present", () => {
    const result = computeProjectHeaderKpis({
      ...baseInput(),
      canonicalRevenueRows: [
        { amountExVat: 1000, status: "PAID", paidDate: "2026-01-01", inBankDate: null },
        { amountExVat: 1000, status: "PLANNED", paidDate: null, inBankDate: null },
      ],
      canonicalCostRows: [
        { amountExVat: 500, cosRealised: true, cosStatusOverride: null },
        { amountExVat: 500, cosRealised: false, cosStatusOverride: null },
      ],
    });

    expect(result.source.revenue).toBe("normalized_revenue_lines");
    expect(result.source.cost).toBe("normalized_cost_lines");
    expect(result.inflowsRealisedPct).toBe(50);
    expect(result.cosRealisedPct).toBe(50);
  });

  it("returns zero percentages when canonical rows are empty", () => {
    const result = computeProjectHeaderKpis({
      ...baseInput(),
      canonicalRevenueRows: [],
      canonicalCostRows: [],
    });

    expect(result.source.revenue).toBe("normalized_revenue_lines");
    expect(result.source.cost).toBe("normalized_cost_lines");
    expect(result.inflowsRealisedPct).toBe(0);
    expect(result.cosRealisedPct).toBe(0);
  });

  it("computes correct percentages from canonical rows only", () => {
    const result = computeProjectHeaderKpis({
      ...baseInput(),
      canonicalRevenueRows: [{ amountExVat: 100, status: "IN_BANK", paidDate: null, inBankDate: "2026-01-01" }],
      canonicalCostRows: [{ amountExVat: 50, cosRealised: true, cosStatusOverride: null }],
    });

    expect(result.inflowsRealisedPct).toBe(100);
    expect(result.cosRealisedPct).toBe(100);
  });

  it("uses budget baseline first, then execution and summary fallback", () => {
    const withBudget = computeProjectHeaderKpis({ ...baseInput(), canonicalRevenueRows: [{ amountExVat: 100, status: "PAID", paidDate: "2026-01-01", inBankDate: null }], budgetBaselineMarginPct: 20 });
    const withExecution = computeProjectHeaderKpis({ ...baseInput(), canonicalRevenueRows: [{ amountExVat: 100, status: "PAID", paidDate: "2026-01-01", inBankDate: null }], executionBaselineMarginPct: 15 });
    const withSummary = computeProjectHeaderKpis({ ...baseInput(), canonicalRevenueRows: [{ amountExVat: 100, status: "PAID", paidDate: "2026-01-01", inBankDate: null }], summaryBaselineMarginPct: 0.1 });

    expect(withBudget.source.baseline).toBe("budget_baselines");
    expect(withExecution.source.baseline).toBe("project_execution_state");
    expect(withSummary.source.baseline).toBe("project_revenue_summary");
    expect(withSummary.baselineMarginPct).toBe(10);
  });

  it("resolves next milestone from current in-progress stage", () => {
    const result = computeProjectHeaderKpis({
      ...baseInput(),
      currentStageCode: "S02_DESIGN_COST_PROPOSAL",
      stageRows: [
        { stageCode: "S02_DESIGN_COST_PROPOSAL", stageStatus: "IN_PROGRESS", targetExitDate: "2026-05-10", nextRequiredAction: "Submit design pack" },
      ],
    });

    expect(result.nextMilestone.name).toBe("Submit design pack");
    expect(result.nextMilestone.date).toBe("2026-05-10");
  });

  it("returns em-dash next milestone when no upcoming milestone exists", () => {
    const result = computeProjectHeaderKpis({ ...baseInput(), stageRows: [] });
    expect(result.nextMilestone.name).toBe("—");
  });

  it("handles zero denominators safely", () => {
    const result = computeProjectHeaderKpis({ ...baseInput() });
    expect(result.inflowsRealisedPct).toBe(0);
    expect(result.cosRealisedPct).toBe(0);
  });

  it("respects COS override semantics for recognised COS", () => {
    const result = computeProjectHeaderKpis({
      ...baseInput(),
      canonicalCostRows: [
        { amountExVat: 100, cosRealised: false, cosStatusOverride: "COS Realised" },
        { amountExVat: 100, cosRealised: true, cosStatusOverride: "Planned" },
      ],
    });

    expect(result.cosRealisedPct).toBe(50);
  });

  it("uses provided projectId and computes independent of projectName", () => {
    const result = computeProjectHeaderKpis({ ...baseInput(), projectId: 999 });
    expect(result.projectId).toBe(999);
  });
});
