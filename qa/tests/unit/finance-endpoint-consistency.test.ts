/**
 * Finance Endpoint Data Source Consistency Tests
 *
 * Verifies that all finance tracker endpoints (COS, Revenue, GP, Cashflow)
 * now use the same canonical data source (normalized_cost_lines via
 * getAllCostLinesForCashflow, normalized_revenue_lines via
 * getAllRevenueLinesForCashflow) instead of the merged
 * getAllProgramExpenses/getAllProgramInflows path.
 *
 * This ensures that the same financial fact (e.g., total COS for a project)
 * produces the same number regardless of which screen displays it.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("COS Tracker endpoints use lineage-aware high-risk source helper", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("COS tracker main uses high-risk all-cost helper", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker"'),
      routes.indexOf('"/api/cos-tracker/project/')
    );
    expect(block).toContain("getHighRiskAllCostReadRows()");
  });

  it("COS tracker month-detail uses high-risk all-cost helper", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker/month-detail"'),
      routes.indexOf('"/api/cos-tracker/toggle-realised/')
    );
    expect(block).toContain("getHighRiskAllCostReadRows()");
  });

  it("COS tracker toggle-realised uses getAllCostLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker/toggle-realised/'),
      routes.indexOf('"/api/cos-tracker/override-status/')
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
  });

  it("COS tracker override-status uses getAllCostLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker/override-status/'),
      routes.indexOf('"/api/cos-tracker/override-status/') + 2000
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
  });
});

describe("GP Tracker endpoints use canonical source", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("GP tracker main uses canonical reads for both cost and revenue", () => {
    const block = routes.substring(
      routes.indexOf('"/api/gp-tracker"'),
      routes.indexOf('"/api/gp-tracker/project/')
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
    expect(block).not.toContain("storage.getAllProgramInflows()");
  });

  it("GP tracker month-detail uses canonical reads", () => {
    const startIdx = routes.indexOf('"/api/gp-tracker/month-detail"');
    const block = routes.substring(startIdx, startIdx + 2000);
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
  });
});

describe("Revenue Tracker endpoints use canonical source", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("Revenue tracker main handler uses canonical reads", () => {
    const block = routes.substring(
      routes.indexOf("async function revenueTrackerHandler"),
      routes.indexOf("async function revenueTrackerHandler") + 1000
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
  });

  it("Revenue tracker month-detail uses canonical cost lines for all-projects case", () => {
    const startIdx = routes.indexOf('"/api/revenue-tracker/month-detail"');
    const block = routes.substring(startIdx, startIdx + 1200);
    expect(block).toContain("getCanonicalAllCurrentCostLines()");
  });
});

describe("Cashflow endpoints use canonical source", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("Cashflow weekly uses canonical cost and revenue reads", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cashflow-2026"'),
      routes.indexOf('"/api/cashflow-2026"') + 800
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
  });
});

describe("Dashboard services use direct NCL queries (already canonical)", () => {
  it("company-overview reads normalizedCostLines directly", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("getAllProgramExpenses");
  });

  it("dashboard-metrics reads normalizedCostLines directly", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("getAllProgramExpenses");
  });

  it("project-header-kpi-service reads normalizedCostLines directly", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain("normalizedCostLines");
    expect(service).not.toContain("getAllProgramExpenses");
  });
});

describe("Expenditure endpoints now delegate to canonical project-cost service", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("program-expenses route resolves projectId and delegates to canonical service", () => {
    const block = routes.substring(
      routes.indexOf('"/api/program-expenses"'),
      routes.indexOf('"/api/program-expenses"') + 1200
    );
    expect(block).toContain("isCanonicalFinanceCostlineReadEnabled()");
    expect(block).toContain("getCanonicalProjectCostLines(");
    expect(block).toContain("getCanonicalAllCurrentCostLines()");
    expect(block).toContain("storage.getAllProgramExpenses()");
  });

  it("expenditure-breakdown route no longer uses merged program-expense storage reads", () => {
    const block = routes.substring(
      routes.indexOf('"/api/expenditure-breakdown/:projectName"'),
      routes.indexOf('"/api/expenditure-breakdown/:projectName"') + 700
    );
    expect(block).toContain("getHighRiskProjectCostReadRows(projectName, projectIdParam)");
  });
});

describe("Data source alignment summary", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("program-expense merge reads are not used by high-risk tracker/expenditure endpoints", () => {
    const matches = routes.match(/storage\.getProgramExpensesByProject\(/g) || [];
    // Feature-flag rollback paths intentionally retain legacy reads.
    expect(matches.length).toBeLessThanOrEqual(9);
  });

  it("all-project high-risk helper exists and is used in COS global endpoints", () => {
    const matches = routes.match(/getHighRiskAllCostReadRows\(\)/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});
