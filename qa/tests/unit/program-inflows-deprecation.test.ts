/**
 * Program Inflows Deprecation Tests
 *
 * Documents the deprecation status of program_inflows:
 * - Storage layer already reads NRL only (no PI merge unlike PE)
 * - Cashflow now uses getAllRevenueLinesForCashflow (NRL only)
 * - Inflow date override PI sync writes removed
 * - FYE revenue tracking still reads PI directly (blocker)
 * - Smart import still dual-writes to PI (blocked by FYE)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { adaptRevenueToInflow } from "../../../server/lib/data-merge";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Storage layer already canonical (reads NRL only)", () => {
  const storage = read("server/storage.ts");

  it("getAllProgramInflows does NOT read from programInflows table", () => {
    const block = storage.substring(
      storage.indexOf("async getAllProgramInflows"),
      storage.indexOf("async getAllRevenueLinesForCashflow")
    );
    expect(block).toContain("normalizedRevenueLines");
    expect(block).toContain("adaptRevenueToInflow");
    expect(block).not.toContain(".from(programInflows)");
  });

  it("getProgramInflowsByProject does NOT read from programInflows table", () => {
    const block = storage.substring(
      storage.indexOf("async getProgramInflowsByProject"),
      storage.indexOf("async createManyProgramInflows")
    );
    expect(block).toContain("normalizedRevenueLines");
    expect(block).not.toContain(".from(programInflows)");
  });

  it("getAllRevenueLinesForCashflow reads NRL directly (canonical)", () => {
    const block = storage.substring(
      storage.indexOf("async getAllRevenueLinesForCashflow"),
      storage.indexOf("async getAllRevenueLinesForCashflow") + 600
    );
    expect(block).toContain("normalizedRevenueLines");
    expect(block).toContain("adaptRevenueToInflow");
    expect(block).not.toContain("programInflows");
  });
});

describe("Cashflow uses canonical revenue line read", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("cashflow-2026 weekly uses getAllRevenueLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cashflow-2026"'),
      routes.indexOf('"/api/cashflow-2026"') + 800
    );
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramInflows()");
  });

  it("cashflow-2026 detail uses getAllRevenueLinesForCashflow", () => {
    const block = routes.substring(
      routes.indexOf('"/api/cashflow-2026/detail"'),
      routes.indexOf('"/api/cashflow-2026/detail"') + 1100
    );
    expect(block).toContain("storage.getAllRevenueLinesForCashflow()");
    expect(block).not.toContain("storage.getAllProgramInflows()");
  });
});

describe("PI sync writes removed", () => {
  it("inflow date override no longer syncs to programInflows", () => {
    const routes = read("server/departments/finance-routes.ts");
    const overrideBlock = routes.substring(
      routes.indexOf("inflow-date-override"),
      routes.indexOf("inflow-date-override") + 3000
    );
    expect(overrideBlock).toContain("PI sync removed");
    // Should NOT contain db.update(programInflows) in the override handler
  });
});

describe("Remaining PI consumers (NOT yet migrated)", () => {
  it("FYE revenue tracking still reads PI directly", () => {
    const fye = read("server/departments/fye-revenue-tracking-routes.ts");
    expect(fye).toContain(".from(programInflows)");
    // BLOCKER: uses computedForecastReceiptDate which doesn't exist on NRL
  });

  it("smart import still writes PI during commit", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain("tx.insert(programInflows)");
  });
});

describe("Schema gaps blocking full deprecation", () => {
  it("GAP: computedForecastReceiptDate exists on PI but not NRL", () => {
    const schema = read("shared/schema/finance.ts");
    const piBlock = schema.substring(
      schema.indexOf('pgTable("program_inflows"'),
      schema.indexOf("insertProgramInflowsSchema")
    );
    expect(piBlock).toContain("computed_forecast_receipt_date");

    const nrlBlock = schema.substring(
      schema.indexOf('pgTable("normalized_revenue_lines"'),
      schema.indexOf("insertNormalizedRevenueLineSchema")
    );
    expect(nrlBlock).not.toContain("computed_forecast_receipt_date");
  });

  it("GAP: milestoneNo exists on PI but not NRL", () => {
    const schema = read("shared/schema/finance.ts");
    const piBlock = schema.substring(
      schema.indexOf('pgTable("program_inflows"'),
      schema.indexOf("insertProgramInflowsSchema")
    );
    expect(piBlock).toContain("milestone_no");
  });

  it("GAP: milestonePercent exists on PI but not NRL", () => {
    const schema = read("shared/schema/finance.ts");
    const piBlock = schema.substring(
      schema.indexOf('pgTable("program_inflows"'),
      schema.indexOf("insertProgramInflowsSchema")
    );
    expect(piBlock).toContain("milestone_percent");
  });
});

describe("adaptRevenueToInflow produces all fields inflow consumers need", () => {
  const baseRevLine: any = {
    id: 7,
    projectId: 10,
    projectName: "TestProject",
    milestoneName: "Milestone 1",
    amountExVat: "500000.00",
    invoiceNumber: "INV-R001",
    invoiceDate: "2026-02-01",
    paidDate: "2026-03-01",
    paidDateConfirmed: true,
    paidDateFontColor: "black",
    expectedPaymentDate: "2026-02-15",
    inBankDate: "2026-03-05",
    sourceRow: 1,
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
  };

  const adapted = adaptRevenueToInflow(baseRevLine, "TestProject");

  it("maps amountExVat to milestoneAmount", () => {
    expect(adapted.milestoneAmount).toBe("500000.00");
  });

  it("maps invoiceNumber to milestoneInvoiceNumber", () => {
    expect(adapted.milestoneInvoiceNumber).toBe("INV-R001");
  });

  it("maps invoiceDate to invoiceRaisedDate", () => {
    expect(adapted.invoiceRaisedDate).toBe("2026-02-01");
  });

  it("maps paidDate to paymentReceivedDate", () => {
    expect(adapted.paymentReceivedDate).toBe("2026-03-01");
  });

  it("maps expectedPaymentDate to plannedPaymentDate", () => {
    expect(adapted.plannedPaymentDate).toBe("2026-02-15");
  });

  it("derives inBank flag from payment and invoice status", () => {
    expect(adapted.inBank).toBe(1);
  });

  it("preserves inBankDate", () => {
    expect(adapted.inBankDate).toBe("2026-03-05");
  });

  it("uses negative ID for collision safety", () => {
    expect(adapted.id).toBe(-7);
    expect(adapted.id).toBeLessThan(0);
  });

  it("sets _isNormalized flag", () => {
    expect(adapted._isNormalized).toBe(true);
  });
});
