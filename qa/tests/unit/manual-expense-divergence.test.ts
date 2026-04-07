/**
 * Manual Expense Divergence Tests
 *
 * Verifies that manual expenses are visible across ALL read paths,
 * not just merged paths. The root cause of divergence was that
 * createManualExpense did NOT resolve projectId from projectName,
 * making manual expenses invisible to dashboard queries that filter
 * by projectId (dashboard-metrics, header-kpis, canonical-kpis).
 *
 * This test suite verifies:
 * 1. createManualExpense now resolves projectId from projectName
 * 2. All direct-read services filter by projectId (and would miss NULL)
 * 3. The divergence matrix is documented and each path is accounted for
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Manual expense — projectId resolution", () => {
  const storage = read("server/storage.ts");

  it("createManualExpense resolves projectId from projectName", () => {
    // The fix: look up projectInfo.id by projectName before inserting
    const createBlock = storage.substring(
      storage.indexOf("async createManualExpense"),
      storage.indexOf("adaptCostToExpense(created, created.projectName)") + 60
    );
    expect(createBlock).toContain("projectInfo.projectName");
    expect(createBlock).toContain("resolvedProjectId");
  });

  it("resolved projectId is included in the mapped insert object", () => {
    const createBlock = storage.substring(
      storage.indexOf("async createManualExpense"),
      storage.indexOf("adaptCostToExpense(created, created.projectName)") + 60
    );
    expect(createBlock).toContain("projectId: resolvedProjectId");
  });

  it("explicit projectId from caller takes precedence over resolution", () => {
    const createBlock = storage.substring(
      storage.indexOf("async createManualExpense"),
      storage.indexOf("adaptCostToExpense(created, created.projectName)") + 60
    );
    // data.projectId ?? null — if caller provides it, use it
    expect(createBlock).toContain("data.projectId ?? null");
  });

  it("gracefully handles projectName not found (resolvedProjectId stays null)", () => {
    const createBlock = storage.substring(
      storage.indexOf("async createManualExpense"),
      storage.indexOf("adaptCostToExpense(created, created.projectName)") + 60
    );
    // The if(pi) check means no crash if projectName doesn't match
    expect(createBlock).toContain("if (pi) resolvedProjectId = pi.id");
  });
});

describe("Direct-read services — projectId dependency proof", () => {
  it("dashboard-metrics filters by projectId (would miss NULL)", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain("eq(normalizedCostLines.projectId, projectId)");
  });

  it("project-header-kpi-service filters by projectId (would miss NULL)", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain("normalizedCostLines.projectId");
  });

  it("financial-review-service filters by projectId (would miss NULL)", () => {
    const service = read("server/services/financial-review-service.ts");
    expect(service).toContain("normalizedCostLines.projectId");
  });

  it("canonical-dashboard-kpi-service filters by projectId (would miss NULL)", () => {
    const service = read("server/services/canonical-dashboard-kpi-service.ts");
    expect(service).toContain("normalizedCostLines.projectId");
  });
});

describe("Merged-read paths — manual expense inclusion", () => {
  const storage = read("server/storage.ts");

  it("getAllProgramExpenses reads normalizedCostLines (includes manual)", () => {
    const allBlock = storage.substring(
      storage.indexOf("async getAllProgramExpenses"),
      storage.indexOf("async getProgramExpensesByProject")
    );
    expect(allBlock).toContain("normalizedCostLines");
    expect(allBlock).toContain("adaptCostToExpense");
  });

  it("getProgramExpensesByProject reads normalizedCostLines (includes manual)", () => {
    const byProjectBlock = storage.substring(
      storage.indexOf("async getProgramExpensesByProject"),
      storage.indexOf("async createManyProgramExpenses")
    );
    expect(byProjectBlock).toContain("normalizedCostLines");
    expect(byProjectBlock).toContain("adaptCostToExpense");
  });

  it("selectWinningExpenseRows merges both normalized and legacy rows", () => {
    const allBlock = storage.substring(
      storage.indexOf("async getAllProgramExpenses"),
      storage.indexOf("async getProgramExpensesByProject")
    );
    expect(allBlock).toContain("selectWinningExpenseRows([...adaptedNormalized, ...legacyAdapted])");
  });
});

describe("Execution dashboard — all-rows read (no projectId filter)", () => {
  const lifecycle = read("server/lifecycle-routes.ts");

  it("execution dashboard reads normalizedCostLines without projectId filter", () => {
    // The execution dashboard reads all rows (no projectId WHERE clause)
    // and includes normalizedCostLines in its imports and queries
    expect(lifecycle).toContain("normalizedCostLines");
    // It reads ALL active cost lines, not filtered by a specific projectId
    expect(lifecycle).toContain(".from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo))");
  });
});

describe("Company overview — all-rows read (no projectId filter)", () => {
  const service = read("server/services/company-overview-service.ts");

  it("company overview reads all normalizedCostLines without projectId filter", () => {
    expect(service).toContain(".from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo))");
  });
});

describe("Divergence matrix — documented screen coverage", () => {
  it("screens using merged path: ExpenditureTab, ExpenditureEditableTab, COS Tracker, Cashflow", () => {
    const financeRoutes = read("server/departments/finance-routes.ts");
    // COS tracker uses getAllProgramExpenses
    expect(financeRoutes).toContain("storage.getAllProgramExpenses()");
    // Expenditure breakdown uses getProgramExpensesByProject
    expect(financeRoutes).toContain("storage.getProgramExpensesByProject(projectName)");
  });

  it("screens using direct reads: Dashboard Metrics, Header KPIs, Financial Review", () => {
    // These all filter by projectId — manual expenses now have projectId set
    const metrics = read("server/services/dashboard-metrics.ts");
    const kpis = read("server/services/project-header-kpi-service.ts");
    const review = read("server/services/financial-review-service.ts");
    expect(metrics).toContain("normalizedCostLines.projectId");
    expect(kpis).toContain("normalizedCostLines.projectId");
    expect(review).toContain("normalizedCostLines.projectId");
  });
});
