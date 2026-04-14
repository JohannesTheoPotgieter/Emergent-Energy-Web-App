/**
 * Cashflow Canonical Read Tests
 *
 * Verifies that cashflow now reads from normalized_cost_lines directly
 * (via getAllCostLinesForCashflow) instead of the merged program_expense
 * path (getAllProgramExpenses). This aligns cashflow with dashboards
 * that read normalized_cost_lines directly.
 *
 * Documents every field cashflow needs and proves they all exist on
 * normalized_cost_lines via the adaptCostToExpense adapter.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { adaptCostToExpense } from "../../../server/lib/data-merge";
import {
  getExpenseEffectiveDateAndSource,
  getOutflowAmountBreakdown,
  isApprovedExpenseRow,
} from "../../../server/lib/expense-row-selector";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// A. ROUTE VERIFICATION — cashflow reads canonical source
// ---------------------------------------------------------------------------

describe("Cashflow route uses canonical cost-line read", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("cashflow-2026 weekly endpoint reads from getAllCostLinesForCashflow", () => {
    const cashflowBlock = routes.substring(
      routes.indexOf('"/api/cashflow-2026"'),
      routes.indexOf('"/api/cashflow-2026"') + 800
    );
    expect(cashflowBlock).toContain("storage.getAllCostLinesForCashflow()");
    expect(cashflowBlock).not.toContain("storage.getAllProgramExpenses()");
  });

  it("cashflow-2026 detail endpoint reads from getAllCostLinesForCashflow", () => {
    const detailBlock = routes.substring(
      routes.indexOf('"/api/cashflow-2026/detail"'),
      routes.indexOf('"/api/cashflow-2026/detail"') + 1100
    );
    expect(detailBlock).toContain("storage.getAllCostLinesForCashflow()");
    expect(detailBlock).not.toContain("storage.getAllProgramExpenses()");
  });
});

describe("Storage layer has canonical cashflow read method", () => {
  const storage = read("server/storage.ts");

  it("interface declares getAllCostLinesForCashflow", () => {
    expect(storage).toContain("getAllCostLinesForCashflow(): Promise<any[]>");
  });

  it("implementation reads normalized_cost_lines only (no program_expense)", () => {
    const implBlock = storage.substring(
      storage.indexOf("async getAllCostLinesForCashflow"),
      storage.indexOf("async getAllCostLinesForCashflow") + 600
    );
    expect(implBlock).toContain("normalizedCostLines");
    expect(implBlock).toContain("adaptCostToExpense");
    expect(implBlock).not.toContain("programExpense");
  });
});

// ---------------------------------------------------------------------------
// B. FIELD MAPPING — all cashflow fields available from NCL
// ---------------------------------------------------------------------------

describe("adaptCostToExpense produces all fields cashflow needs", () => {
  const baseCostLine: any = {
    id: 42,
    projectId: 10,
    projectName: "TestProject",
    costCategory: "Materials",
    description: "Steel beams",
    amountExVat: "125000.50",
    invoiceNumber: "INV-001",
    invoiceDate: "2026-01-15",
    invoiceDateConfirmed: true,
    invoiceDateFontColor: "black",
    paidDate: "2026-02-15",
    paidDateConfirmed: true,
    paidDateFontColor: "black",
    poNumber: "PO-001",
    counterpartyName: "Steel Co",
    sourceRow: 7,
    approvedDate: "2026-01-20",
    noRevenueLinked: false,
    budgetQty: "10",
    budgetRate: "12000",
    budgetTotal: "120000",
    budgetCos: "120000",
    forecastPaymentDate: "2026-03-01",
    adminDateOverride: null,
    status: "INVOICED",
    cosStatusOverride: null,
  };

  const adapted = adaptCostToExpense(baseCostLine, "TestProject");

  it("provides adminDateOverride for date priority #1", () => {
    expect(adapted).toHaveProperty("adminDateOverride");
  });

  it("provides expensePaymentDate for date priority #2", () => {
    expect(adapted).toHaveProperty("expensePaymentDate");
    expect(adapted.expensePaymentDate).toBe("2026-02-15"); // paidDate takes precedence
  });

  it("provides forecastPaymentDate for date priority #4", () => {
    expect(adapted).toHaveProperty("forecastPaymentDate");
    expect(adapted.forecastPaymentDate).toBe("2026-03-01");
  });

  it("provides expenseInvoicedDate for date priority #5", () => {
    expect(adapted).toHaveProperty("expenseInvoicedDate");
    expect(adapted.expenseInvoicedDate).toBe("2026-01-15");
  });

  it("provides expenseActualTotal for actual amount", () => {
    expect(adapted).toHaveProperty("expenseActualTotal");
    expect(adapted.expenseActualTotal).toBe("125000.50");
  });

  it("provides budgetTotal for forecast amount fallback", () => {
    expect(adapted).toHaveProperty("budgetTotal");
    expect(adapted.budgetTotal).toBe("120000");
  });

  it("provides approvedDate for approval check", () => {
    expect(adapted).toHaveProperty("approvedDate");
    expect(adapted.approvedDate).toBe("2026-01-20");
  });

  it("provides paymentDateConfirmed for past-due check", () => {
    expect(adapted).toHaveProperty("paymentDateConfirmed");
  });

  it("provides paymentDateFontColor for past-due check", () => {
    expect(adapted).toHaveProperty("paymentDateFontColor");
  });

  it("sets rowType to item", () => {
    expect(adapted.rowType).toBe("item");
  });
});

// ---------------------------------------------------------------------------
// C. DATE CHAIN — adapted NCL rows cover all date priorities
// ---------------------------------------------------------------------------

describe("Cashflow date chain works with adapted NCL rows", () => {
  it("row with paidDate uses expensePaymentDate (priority #2)", () => {
    const adapted = adaptCostToExpense({
      id: 1, paidDate: "2026-02-15", forecastPaymentDate: "2026-03-01",
      invoiceDate: "2026-01-15", paidDateConfirmed: true, paidDateFontColor: "black",
    } as any, "X");
    const dateInfo = getExpenseEffectiveDateAndSource(adapted);
    expect(dateInfo.source).toBe("expensePaymentDate");
    expect(dateInfo.date).toBe("2026-02-15");
  });

  it("row with forecastPaymentDate but no paidDate still gets date via expensePaymentDate", () => {
    // adaptCostToExpense folds forecastPaymentDate into expensePaymentDate
    const adapted = adaptCostToExpense({
      id: 2, paidDate: null, forecastPaymentDate: "2026-03-01",
      invoiceDate: "2026-01-15",
    } as any, "X");
    const dateInfo = getExpenseEffectiveDateAndSource(adapted);
    expect(dateInfo.source).toBe("expensePaymentDate");
    expect(dateInfo.date).toBe("2026-03-01");
  });

  it("row with only invoiceDate uses expenseInvoicedDate (priority #5)", () => {
    const adapted = adaptCostToExpense({
      id: 3, paidDate: null, forecastPaymentDate: null,
      invoiceDate: "2026-01-15",
    } as any, "X");
    const dateInfo = getExpenseEffectiveDateAndSource(adapted);
    expect(dateInfo.source).toBe("expenseInvoicedDate");
    expect(dateInfo.date).toBe("2026-01-15");
  });

  it("row with adminDateOverride gets that first (priority #1)", () => {
    const adapted = adaptCostToExpense({
      id: 4, paidDate: "2026-02-15", forecastPaymentDate: "2026-03-01",
      invoiceDate: "2026-01-15", adminDateOverride: "2026-04-01",
    } as any, "X");
    const dateInfo = getExpenseEffectiveDateAndSource(adapted);
    expect(dateInfo.source).toBe("adminDateOverride");
    expect(dateInfo.date).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// D. AMOUNT LOGIC — adapted NCL rows provide correct actual/forecast amounts
// ---------------------------------------------------------------------------

describe("Cashflow amount logic works with adapted NCL rows", () => {
  it("approved row with actual amount returns actual type", () => {
    const adapted = adaptCostToExpense({
      id: 1, amountExVat: "50000", approvedDate: "2026-01-20",
      invoiceNumber: "INV-001", invoiceDate: "2026-01-15",
      invoiceDateConfirmed: true, invoiceDateFontColor: "black",
      paidDate: "2026-02-15", paidDateConfirmed: true, paidDateFontColor: "black",
    } as any, "X");
    const breakdown = getOutflowAmountBreakdown(adapted);
    expect(breakdown.type).toBe("actual");
    expect(breakdown.amount).toBe(50000);
  });

  it("row without confirmed paid date buckets as forecast at the actual amount (never budgetTotal)", () => {
    // Per the corrected spec, getOutflowAmountBreakdown always returns
    // amount_ex_vat. The legacy budgetTotal fallback was over-counting
    // cashflow outflows, so this test asserts the new behaviour.
    const adapted = adaptCostToExpense({
      id: 2, amountExVat: "50000", budgetTotal: "45000",
    } as any, "X");
    const breakdown = getOutflowAmountBreakdown(adapted);
    expect(breakdown.type).toBe("forecast");
    expect(breakdown.amount).toBe(50000);
    expect(breakdown.amountSource).toBe("expenseActualTotal");
  });
});

// ---------------------------------------------------------------------------
// E. CONSISTENCY — cashflow now uses same source as dashboards
// ---------------------------------------------------------------------------

describe("Cashflow source aligned with dashboard services", () => {
  it("company-overview reads normalized_cost_lines directly", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain(".from(normalizedCostLines)");
  });

  it("dashboard-metrics reads normalized_cost_lines directly", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain(".from(normalizedCostLines)");
  });

  it("cashflow now reads normalized_cost_lines only (via getAllCostLinesForCashflow)", () => {
    const storage = read("server/storage.ts");
    const implBlock = storage.substring(
      storage.indexOf("async getAllCostLinesForCashflow"),
      storage.indexOf("async getAllCostLinesForCashflow") + 600
    );
    expect(implBlock).toContain(".from(normalizedCostLines)");
    expect(implBlock).not.toContain("programExpense");
  });
});

// ---------------------------------------------------------------------------
// F. NUMBER CHANGE DOCUMENTATION
// ---------------------------------------------------------------------------

describe("Expected number changes from canonical migration", () => {
  it("DOCUMENTED: forecastPaymentDate gets promoted to expensePaymentDate (higher priority)", () => {
    // In the old merged path, forecastPaymentDate was priority #4 in the date chain.
    // In the new canonical path, adaptCostToExpense folds forecastPaymentDate
    // into expensePaymentDate (priority #2) when paidDate is null.
    // Net effect: forecast dates are found SOONER in the priority chain.
    // This does NOT change which dates are used — it changes the priority label.
    const adapted = adaptCostToExpense({
      id: 1, paidDate: null, forecastPaymentDate: "2026-03-01",
    } as any, "X");
    expect(adapted.expensePaymentDate).toBe("2026-03-01");
    // This means getExpenseEffectiveDateAndSource picks it up at priority #2 instead of #4
  });

  it("DOCUMENTED: computedForecastPaymentDate is null in canonical path", () => {
    // computedForecastPaymentDate was populated only from program_expense rows.
    // In the canonical path, it's always null.
    // This field is priority #3 in the date chain, but since forecastPaymentDate
    // is folded into expensePaymentDate (priority #2), dates that were at #3
    // are now at #2 — strictly better coverage.
    const adapted = adaptCostToExpense({
      id: 1, paidDate: null, forecastPaymentDate: null,
    } as any, "X");
    expect(adapted.computedForecastPaymentDate).toBeNull();
  });

  it("getAllCostLinesForCashflow does not reference the retired programExpense table", () => {
    // program_expense was retired in the PE/PI cutover. The canonical
    // cashflow read is normalized_cost_lines only. This is an
    // anti-regression check to prevent anyone from re-introducing a
    // PE read path to the cashflow code.
    const storage = read("server/storage.ts");
    const implBlock = storage.substring(
      storage.indexOf("async getAllCostLinesForCashflow"),
      storage.indexOf("async getAllCostLinesForCashflow") + 600
    );
    expect(implBlock).not.toContain("programExpense");
  });
});
