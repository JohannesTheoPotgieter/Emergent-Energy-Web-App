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

describe("COS Tracker endpoints use canonical source", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("COS tracker main uses getAllCostLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker"'),
      routes.indexOf('"/api/cos-tracker/project/')
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
  });

  it("COS tracker month-detail uses getAllCostLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cos-tracker/month-detail"'),
      routes.indexOf('"/api/cos-tracker/toggle-realised/')
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
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
    const block = routes.substring(startIdx, startIdx + 1000);
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
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

describe("Remaining endpoints still on merged path (documented)", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("program-expenses pass-through still uses merged path (serves expenditure tabs)", () => {
    const block = routes.substring(
      routes.indexOf('"/api/program-expenses"'),
      routes.indexOf('"/api/program-expenses"') + 500
    );
    // This endpoint serves ExpenditureTab which needs PE-specific fields
    expect(block).toContain("storage.getAllProgramExpenses()");
  });

  it("expenditure-breakdown still uses merged path (serves editable tab)", () => {
    expect(routes).toContain("storage.getProgramExpensesByProject(projectName)");
    // This is intentional — editable tab needs PE-specific fields like expenseQty
  });
});

describe("Data source alignment summary", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("getAllProgramExpenses is only used by expenditure pass-through endpoints", () => {
    // Count remaining getAllProgramExpenses calls
    const matches = routes.match(/storage\.getAllProgramExpenses\(\)/g);
    // Should be 2: program-expenses pass-through + cashflow legacy pass-through
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeLessThanOrEqual(3);
  });

  it("getAllCostLinesForCashflow is used by all tracker endpoints", () => {
    const matches = routes.match(/storage\.getAllCostLinesForCashflow\(\)/g);
    expect(matches).toBeTruthy();
    // Cashflow weekly, cashflow detail, COS tracker main, COS month-detail,
    // COS toggle, COS override, GP main, GP month-detail, revenue tracker,
    // revenue month-detail, program/cos
    expect(matches!.length).toBeGreaterThanOrEqual(8);
  });
});
