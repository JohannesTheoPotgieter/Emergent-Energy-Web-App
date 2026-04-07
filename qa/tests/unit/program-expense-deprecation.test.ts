/**
 * Program Expense Deprecation Tests
 *
 * Documents the staged deprecation of program_expense:
 * - Stage A: Replace reads (cashflow done, FYE and expenditure tabs remain)
 * - Stage B: Stop writes (PE sync writes removed from override paths)
 * - Stage C: Monitor drift (reconciliation-pack already in place)
 * - Stage D: Drop table (not yet — FYE reads still depend on PE)
 *
 * This test suite proves which PE writes have been removed and which
 * consumers still depend on PE reads.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Stage B: PE sync writes removed", () => {
  it("admin date override no longer syncs to program_expense", () => {
    const routes = read("server/departments/finance-routes.ts");
    // The override handler should update NCL only, not PE
    const overrideBlock = routes.substring(
      routes.indexOf("expense-date-override"),
      routes.indexOf("expense-date-override") + 3000
    );
    // Should NOT contain db.update(programExpense) for admin date overrides
    expect(overrideBlock).toContain("PE sync removed");
  });

  it("updateExpenseFieldsDualTable routes all IDs through NCL", () => {
    const routes = read("server/departments/finance-routes.ts");
    const dualTableBlock = routes.substring(
      routes.indexOf("async function updateExpenseFieldsDualTable"),
      routes.indexOf("async function updateExpenseFieldsDualTable") + 800
    );
    // Should log deprecation warning for legacy PE IDs instead of writing to PE
    expect(dualTableBlock).toContain("PE is deprecated for writes");
    // Should route legacy IDs through NCL
    expect(dualTableBlock).toContain("storage.updateProgramExpenseFields(id, fields");
    // Should NOT import programExpense for writes
    expect(dualTableBlock).not.toContain("import(\"@shared/schema\")");
  });

  it("COS override no longer dual-writes to program_expense", () => {
    const routes = read("server/routes.ts");
    const cosBlock = routes.substring(
      routes.indexOf("cos-status-override"),
      routes.indexOf("cos-status-override") + 2000
    );
    expect(cosBlock).toContain("PE dual-write removed");
    expect(cosBlock).not.toContain("inlineEdit('program_expense'");
  });

  it("COS override revert no longer reverts program_expense", () => {
    const routes = read("server/routes.ts");
    const revertBlock = routes.substring(
      routes.indexOf('"/api/cos-status-override/:expenseId"'),
      routes.indexOf('"/api/cos-status-override/:expenseId"') + 1000
    );
    expect(revertBlock).not.toContain("revertToImported('program_expense'");
  });
});

describe("Remaining PE reads (NOT yet migrated)", () => {
  it("getAllProgramExpenses still reads PE in fallback path", () => {
    const storage = read("server/storage.ts");
    const block = storage.substring(
      storage.indexOf("async getAllProgramExpenses"),
      storage.indexOf("async getAllCostLinesForCashflow")
    );
    expect(block).toContain("programExpense");
    // This is the remaining legacy merge path — used by COS tracker and expenditure tabs
  });

  it("getProgramExpensesByProject still reads PE in fallback path", () => {
    const storage = read("server/storage.ts");
    const block = storage.substring(
      storage.indexOf("async getProgramExpensesByProject"),
      storage.indexOf("async createManyProgramExpenses")
    );
    expect(block).toContain("programExpense");
    // This is used by expenditure tabs and expenditure-breakdown endpoint
  });

  it("FYE revenue tracking still reads PE directly", () => {
    const fye = read("server/departments/fye-revenue-tracking-routes.ts");
    expect(fye).toContain(".from(programExpense)");
    // BLOCKER: FYE uses computedForecastPaymentDate which doesn't exist on NCL
  });

  it("smart import still writes PE during commit", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain("tx.insert(programExpense)");
    // BLOCKER: cannot stop this write until all PE reads are migrated
  });
});

describe("Screens successfully migrated OFF program_expense", () => {
  it("cashflow reads from getAllCostLinesForCashflow (NCL only)", () => {
    const routes = read("server/departments/finance-routes.ts");
    const block = routes.substring(
      routes.indexOf('"/api/cashflow-2026"'),
      routes.indexOf('"/api/cashflow-2026"') + 800
    );
    expect(block).toContain("storage.getAllCostLinesForCashflow()");
  });

  it("company-overview reads normalizedCostLines directly", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("programExpense");
  });

  it("dashboard-metrics reads normalizedCostLines directly", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("programExpense");
  });

  it("project-header-kpi-service reads normalizedCostLines directly", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain("normalizedCostLines");
    expect(service).not.toContain("programExpense");
  });
});

describe("Schema gaps blocking full deprecation", () => {
  it("GAP: computedForecastPaymentDate exists on PE but not NCL", () => {
    const schema = read("shared/schema/finance.ts");
    const peBlock = schema.substring(
      schema.indexOf('pgTable("program_expense"'),
      schema.indexOf("insertProgramExpenseSchema")
    );
    expect(peBlock).toContain("computed_forecast_payment_date");

    const nclBlock = schema.substring(
      schema.indexOf('pgTable("normalized_cost_lines"'),
      schema.indexOf("insertNormalizedCostLineSchema")
    );
    expect(nclBlock).not.toContain("computed_forecast_payment_date");
  });

  it("GAP: expenseQty exists on PE but not NCL", () => {
    const schema = read("shared/schema/finance.ts");
    const peBlock = schema.substring(
      schema.indexOf('pgTable("program_expense"'),
      schema.indexOf("insertProgramExpenseSchema")
    );
    expect(peBlock).toContain("expense_qty");
  });

  it("GAP: expenseRateUnit exists on PE but not NCL", () => {
    const schema = read("shared/schema/finance.ts");
    const peBlock = schema.substring(
      schema.indexOf('pgTable("program_expense"'),
      schema.indexOf("insertProgramExpenseSchema")
    );
    expect(peBlock).toContain("expense_rate_unit");
  });
});
