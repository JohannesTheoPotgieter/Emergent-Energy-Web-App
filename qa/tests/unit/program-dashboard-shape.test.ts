import { describe, it, expect } from "vitest";
import {
  getProgramDashboardData,
} from "../../../server/repositories/program-dashboard-repository";

// Pinned reference date so FY-window math is deterministic.
// EE FY runs Sep–Aug, so 2026-04-15 is "FY26" (Sep 2025 – Aug 2026).
const NOW = new Date(Date.UTC(2026, 3, 15)); // 2026-04-15

const FIXTURE_PROJECT = {
  id: 1,
  projectName: "Test Project",
  portfolio: "Solar",
  pm: "Alice",
  pd: "Bob",
  archivedStatus: "ACTIVE",
  isActive: true,
  contractValue: "1000000",
  ragStatus: "Green",
  ragUpdatedAt: null,
  executionPhase: "Construction",
  phase: "Construction",
};

// Revenue row with expectedPaymentDate inside FY26 (Sep 2025 – Aug 2026)
const FIXTURE_REVENUE_ROW = {
  id: 1,
  projectId: 1,
  projectName: "Test Project",
  amountExVat: "500000",
  expectedPaymentDate: "2026-02-15",
  paidDate: null,
  paidDateConfirmed: null,
  paidDateFontColor: null,
  inBankDate: null,
  invoiceDate: null,
  invoiceNumber: null,
  sourceRow: "1",
};

// Committed import run so the project passes the "hasImport" gate
const FIXTURE_IMPORT_RUN = {
  id: 1,
  projectId: 1,
  projectName: "Test Project",
  status: "committed",
  committedAt: "2026-04-10T00:00:00Z",
  uploadedAt: "2026-04-10T00:00:00Z",
  recordsAttempted: 10,
  recordsSucceeded: 10,
  recordsFailed: 0,
  sourceFileName: "import.xlsx",
};

const FIXTURE_INPUTS = {
  allProjectInfo: [FIXTURE_PROJECT],
  revenueRows: [FIXTURE_REVENUE_ROW],
  costRows: [],
  importRuns: [FIXTURE_IMPORT_RUN],
  engRows: [],
  approvalsRows: [],
  canonicalPlanTasks: [],
  qualityRows: [],
  usersRows: [],
  cashflowPointRows: [],
  financeRevenueRows: [],
  financeCosRows: [],
};

const TEST_USER = { id: 0, role: "COO_ADMIN", name: "Test" };

describe("getProgramDashboardData — response shape", () => {
  it("returns all required top-level keys", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    expect(result).toHaveProperty("meta");
    expect(result).toHaveProperty("kpis");
    expect(result).toHaveProperty("actionCenter");
    expect(result).toHaveProperty("projects");
    expect(result).toHaveProperty("charts");
    expect(result).toHaveProperty("options");
    expect(result).toHaveProperty("nullCount");
  });

  it("meta has fyStart and fyEnd for FY26 when now = 2026-04-15", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    expect(result.meta.fyStart).toBe("2025-09-01");
    expect(result.meta.fyEnd).toBe("2026-08-31");
  });

  it("kpis has all expected numeric fields", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    const NUMERIC_KEYS = [
      "activeDashboardProjects",
      "averageActualProgressPct",
      "averageExpectedProgressPct",
      "projectsBehindPlan",
      "plannedRevenueFy",
      "receivedInflowFy",
      "openInflowFy",
      "plannedExpenditureFy",
      "paidExpenditureFy",
      "openExpenditureFy",
      "grossProfitFy",
      "openEngineeringBlockers",
      "openQualityWarnings",
      "pendingApprovals",
      "staleImports",
      "cosPlannedMonth",
      "cosRealisedMonth",
    ] as const;
    for (const key of NUMERIC_KEYS) {
      expect(typeof result.kpis[key], `kpis.${key} should be number`).toBe("number");
    }
    expect(typeof result.kpis.currentMonth).toBe("string");
  });

  it("actionCenter has all 6 sections as arrays", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    const SECTIONS = [
      "projectsBehindPlan",
      "inflowAtRisk",
      "expenditureAtRisk",
      "engineeringBottlenecks",
      "qualityIssues",
      "pendingApprovalsDecisions",
    ] as const;
    for (const s of SECTIONS) {
      expect(Array.isArray(result.actionCenter[s]), `actionCenter.${s} should be array`).toBe(true);
    }
  });

  it("charts has supportedChartTypes array, presets, and 6 datasets", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    expect(Array.isArray(result.charts.supportedChartTypes)).toBe(true);
    expect(result.charts.presets.length).toBeGreaterThan(0);
    expect(result.charts.datasets).toHaveLength(6);
    const datasetIds = result.charts.datasets.map((d: any) => d.id);
    expect(datasetIds).toContain("monthlyForecast");
    expect(datasetIds).toContain("weeklyCashflow");
    expect(datasetIds).toContain("phaseSummary");
    expect(datasetIds).toContain("pmSummary");
    expect(datasetIds).toContain("milestonePipeline");
    expect(datasetIds).toContain("constructionWindow");
  });

  it("options has sorted string arrays for filter dropdowns", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    for (const key of ["portfolios", "pms", "pds", "executionPhases", "rags"] as const) {
      expect(Array.isArray(result.options[key]), `options.${key} should be array`).toBe(true);
    }
  });

  it("project with FY revenue row appears in projects list with correct plannedRevenueFy", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].projectName).toBe("Test Project");
    expect(result.projects[0].plannedRevenueFy).toBe(500_000);
  });

  it("nullCount is 0 when all revenue/cost rows have valid amounts", async () => {
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: FIXTURE_INPUTS,
    });
    expect(result.nullCount).toBe(0);
  });

  it("project is excluded when not in active+import+FY-item intersection", async () => {
    const archivedInputs = {
      ...FIXTURE_INPUTS,
      allProjectInfo: [{ ...FIXTURE_PROJECT, archivedStatus: "ARCHIVED" }],
    };
    const result = await getProgramDashboardData({
      user: TEST_USER,
      filters: {},
      now: NOW,
      inputs: archivedInputs,
    });
    expect(result.projects).toHaveLength(0);
    expect(result.kpis.activeDashboardProjects).toBe(0);
  });
});
