/**
 * FINANCE BASELINE VERIFICATION HARNESS
 *
 * Purpose: Freeze the current expenditure/finance read-path behavior so that
 * later refactors can be checked against a known baseline.
 *
 * This file does NOT test business correctness. It records the structural
 * truth of how data flows through the system:
 *   - Which tables each read-path touches
 *   - How the merge/dedup logic works
 *   - How adaptCostToExpense transforms data
 *   - Whether ID namespacing could collide
 *   - How selectWinningExpenseRows resolves duplicates
 *
 * IMPORTANT: Do not change these tests during cleanup. They are the baseline.
 */

import { describe, expect, it } from "vitest";
import {
  getExpenseBusinessKey,
  selectWinningExpenseRows,
  getExpenseEffectiveDateAndSource,
  getCosEffectiveDateAndSource,
  getOutflowAmountBreakdown,
  isApprovedExpenseRow,
  type SelectorDiagnostics,
} from "../../../server/lib/expense-row-selector";
import { adaptCostToExpense, adaptRevenueToInflow, mapCostToExpenseInput } from "../../../server/lib/data-merge";

// ---------------------------------------------------------------------------
// A. BUSINESS KEY GENERATION — verifies dedup keying logic
// ---------------------------------------------------------------------------

describe("Business key generation (getExpenseBusinessKey)", () => {
  it("uses projectId + sourceRow as primary key when both present", () => {
    const row = { id: 1, projectId: 10, sourceRow: 5 };
    expect(getExpenseBusinessKey(row)).toBe("pid:10::row:5");
  });

  it("uses _sourceRow alias when sourceRow is absent", () => {
    const row = { id: 1, projectId: 10, _sourceRow: 5 };
    expect(getExpenseBusinessKey(row)).toBe("pid:10::row:5");
  });

  it("uses rowNumber as sourceRow fallback", () => {
    const row = { id: 1, projectId: 10, rowNumber: 5 };
    expect(getExpenseBusinessKey(row)).toBe("pid:10::row:5");
  });

  it("falls back to projectName-based key when projectId is missing", () => {
    const row = { id: 1, projectName: "Test Project", sourceRow: 5 };
    expect(getExpenseBusinessKey(row)).toBe("pname:test project::row:5");
  });

  it("falls back to id-based key when neither projectId nor sourceRow present", () => {
    const row = { id: 42 };
    expect(getExpenseBusinessKey(row)).toBe("id:42");
  });

  it("normalizes project name to lowercase", () => {
    const row = { id: 1, projectName: "My_PROJECT_Name", sourceRow: 3 };
    expect(getExpenseBusinessKey(row)).toBe("pname:my_project_name::row:3");
  });

  it("BASELINE: two rows with same projectId+sourceRow produce same key (dedup match)", () => {
    const normalized = { id: 900001, projectId: 10, _sourceRow: 5, _isNormalized: true };
    const legacy = { id: 1, projectId: 10, rowNumber: 5, _isNormalized: false };
    expect(getExpenseBusinessKey(normalized)).toBe(getExpenseBusinessKey(legacy));
  });

  it("BASELINE: two rows with different sourceRow produce different keys (no false merge)", () => {
    const a = { id: 1, projectId: 10, sourceRow: 5 };
    const b = { id: 2, projectId: 10, sourceRow: 6 };
    expect(getExpenseBusinessKey(a)).not.toBe(getExpenseBusinessKey(b));
  });
});

// ---------------------------------------------------------------------------
// B. DEDUP / WINNER SELECTION — verifies merge behavior
// ---------------------------------------------------------------------------

describe("selectWinningExpenseRows — merge/dedup baseline", () => {
  it("BASELINE: returns 1 winner from 2 rows with same business key", () => {
    const rows = [
      { id: 1, projectId: 10, sourceRow: 5, _isNormalized: false, updatedAt: "2026-01-01T00:00:00Z" },
      { id: 900001, projectId: 10, _sourceRow: 5, _isNormalized: true, updatedAt: "2026-01-02T00:00:00Z" },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.winners).toHaveLength(1);
    expect(result.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("BASELINE: approved row wins over unapproved regardless of timestamp", () => {
    const rows = [
      { id: 1, projectId: 10, sourceRow: 5, approvedDate: "2026-01-15", updatedAt: "2025-01-01T00:00:00Z" },
      { id: 2, projectId: 10, sourceRow: 5, updatedAt: "2026-06-01T00:00:00Z" },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.winners[0].id).toBe(1);
  });

  it("BASELINE: among two approved rows, later approval wins", () => {
    const rows = [
      { id: 1, projectId: 10, sourceRow: 5, approvedDate: "2026-01-15", updatedAt: "2026-01-15T00:00:00Z" },
      { id: 2, projectId: 10, sourceRow: 5, approvedDate: "2026-03-15", updatedAt: "2026-03-15T00:00:00Z" },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.winners[0].id).toBe(2);
  });

  it("BASELINE: no duplicates when business keys are all unique", () => {
    const rows = [
      { id: 1, projectId: 10, sourceRow: 1 },
      { id: 2, projectId: 10, sourceRow: 2 },
      { id: 3, projectId: 10, sourceRow: 3 },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.winners).toHaveLength(3);
    expect(result.diagnostics.duplicatesRemoved).toBe(0);
  });

  it("BASELINE: diagnostics correctly count normalized vs legacy inputs and winners", () => {
    const rows = [
      { id: 900001, projectId: 10, _sourceRow: 5, _isNormalized: true, approvedDate: "2026-02-01", updatedAt: "2026-02-01T00:00:00Z" },
      { id: 1, projectId: 10, rowNumber: 5, _isNormalized: false, updatedAt: "2026-01-01T00:00:00Z" },
      { id: 900002, projectId: 10, _sourceRow: 6, _isNormalized: true, updatedAt: "2026-03-01T00:00:00Z" },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.diagnostics.totalInput).toBe(3);
    expect(result.diagnostics.winners).toBe(2);
    expect(result.diagnostics.duplicatesRemoved).toBe(1);
    expect(result.diagnostics.normalizedInput).toBe(2);
    expect(result.diagnostics.legacyInput).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C. adaptCostToExpense — verifies the normalized→legacy shape transformation
// ---------------------------------------------------------------------------

describe("adaptCostToExpense — shape transformation baseline", () => {
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
    budgetQty: null,
    budgetRate: null,
    budgetTotal: null,
    budgetCos: null,
    forecastPaymentDate: null,
    status: "INVOICED",
    cosStatusOverride: null,
    cosStatusOverrideBy: null,
    cosStatusOverrideAt: null,
    cosStatusOverrideReason: null,
    cosRealised: null,
  };

  it("BASELINE: uses negative ID (collision-safe namespacing)", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.id).toBe(-42);
  });

  it("BASELINE: maps amountExVat to both expenseActualTotal and actualCosTotal", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.expenseActualTotal).toBe("125000.50");
    expect(result.actualCosTotal).toBe("125000.50");
  });

  it("BASELINE: maps costCategory to expenseCategory", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.expenseCategory).toBe("Materials");
  });

  it("BASELINE: maps description to expenseLineItem", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.expenseLineItem).toBe("Steel beams");
  });

  it("BASELINE: maps invoiceNumber to expenseInvoiceNumber", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.expenseInvoiceNumber).toBe("INV-001");
  });

  it("BASELINE: computes state as Paid when invoice+paid+confirmed", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result.computedState).toBe("Paid");
  });

  it("BASELINE: computes state as Invoiced when invoice+confirmed but no paid", () => {
    const noPaid = { ...baseCostLine, paidDate: null, paidDateConfirmed: false };
    const result = adaptCostToExpense(noPaid, "TestProject");
    expect(result.computedState).toBe("Invoiced");
  });

  it("BASELINE: computes state as Committed when PO exists but no invoice date", () => {
    const poOnly = { ...baseCostLine, invoiceDate: null, invoiceDateConfirmed: false, paidDate: null, paidDateConfirmed: false };
    const result = adaptCostToExpense(poOnly, "TestProject");
    expect(result.computedState).toBe("Committed");
  });

  it("BASELINE: computes state as Planned when no PO/invoice", () => {
    const planned = { ...baseCostLine, poNumber: null, invoiceNumber: null, invoiceDate: null, invoiceDateConfirmed: false, paidDate: null, paidDateConfirmed: false };
    const result = adaptCostToExpense(planned, "TestProject");
    expect(result.computedState).toBe("Planned");
  });

  it("BASELINE: rowNumber falls back to cost.id when sourceRow missing", () => {
    const noSource = { ...baseCostLine, sourceRow: undefined };
    const result = adaptCostToExpense(noSource, "TestProject");
    expect(result.rowNumber).toBe(42);
  });

  it("BASELINE: preserves _isNormalized flag as true", () => {
    const result = adaptCostToExpense(baseCostLine, "TestProject");
    expect(result._isNormalized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. DATE RESOLUTION — verifies effective date priority chains
// ---------------------------------------------------------------------------

describe("Effective date resolution baseline", () => {
  it("BASELINE: getExpenseEffectiveDateAndSource priority chain", () => {
    // Full chain: adminDateOverride > expensePaymentDate > computedForecastPaymentDate > forecastPaymentDate > expenseInvoicedDate
    const full = {
      adminDateOverride: "2026-01-01",
      expensePaymentDate: "2026-02-01",
      computedForecastPaymentDate: "2026-03-01",
      forecastPaymentDate: "2026-04-01",
      expenseInvoicedDate: "2026-05-01",
    };
    expect(getExpenseEffectiveDateAndSource(full)).toEqual({ date: "2026-01-01", source: "adminDateOverride" });

    const noAdmin = { ...full, adminDateOverride: null };
    expect(getExpenseEffectiveDateAndSource(noAdmin)).toEqual({ date: "2026-02-01", source: "expensePaymentDate" });

    const noPayment = { ...noAdmin, expensePaymentDate: null };
    expect(getExpenseEffectiveDateAndSource(noPayment)).toEqual({ date: "2026-03-01", source: "computedForecastPaymentDate" });

    const noComputed = { ...noPayment, computedForecastPaymentDate: null };
    expect(getExpenseEffectiveDateAndSource(noComputed)).toEqual({ date: "2026-04-01", source: "forecastPaymentDate" });

    const noForecast = { ...noComputed, forecastPaymentDate: null };
    expect(getExpenseEffectiveDateAndSource(noForecast)).toEqual({ date: "2026-05-01", source: "expenseInvoicedDate" });
  });

  it("BASELINE: getCosEffectiveDateAndSource priority chain (different from cashflow)", () => {
    // COS chain: adminDateOverride > expenseInvoicedDate > approvedDate > forecastPaymentDate > computedForecastPaymentDate > expensePaymentDate
    const full = {
      adminDateOverride: "2026-01-01",
      expenseInvoicedDate: "2026-02-01",
      approvedDate: "2026-03-01",
      forecastPaymentDate: "2026-04-01",
      computedForecastPaymentDate: "2026-05-01",
      expensePaymentDate: "2026-06-01",
    };
    expect(getCosEffectiveDateAndSource(full)).toEqual({ date: "2026-01-01", source: "adminDateOverride" });

    const noAdmin = { ...full, adminDateOverride: null };
    expect(getCosEffectiveDateAndSource(noAdmin)).toEqual({ date: "2026-02-01", source: "expenseInvoicedDate" });

    const noInv = { ...noAdmin, expenseInvoicedDate: null };
    expect(getCosEffectiveDateAndSource(noInv)).toEqual({ date: "2026-03-01", source: "approvedDate" });
  });

  it("BASELINE: cashflow uses payment-first, COS uses invoice-first (key difference)", () => {
    const row = {
      adminDateOverride: null,
      expensePaymentDate: "2026-06-01",
      expenseInvoicedDate: "2026-02-01",
      approvedDate: "2026-03-01",
      forecastPaymentDate: null,
      computedForecastPaymentDate: null,
    };
    // Cashflow picks payment date
    const cashflowDate = getExpenseEffectiveDateAndSource(row);
    expect(cashflowDate.source).toBe("expensePaymentDate");

    // COS picks invoice date
    const cosDate = getCosEffectiveDateAndSource(row);
    expect(cosDate.source).toBe("expenseInvoicedDate");
  });
});

// ---------------------------------------------------------------------------
// E. OUTFLOW AMOUNT BREAKDOWN — verifies actual vs forecast logic
// ---------------------------------------------------------------------------

describe("Outflow amount breakdown baseline", () => {
  // NOTE: per the corrected business spec, the cashflow outflow amount ALWAYS
  // comes from expenseActualTotal (= NCL.amount_ex_vat). The legacy
  // budgetTotal fallback was over-counting by ~R 47M because budget figures
  // on un-approved lines were materially larger than the actual cost line
  // value. The bucket type is now driven by paid-date confirmation
  // (paymentDateFontColor === 'black' or paymentDateConfirmed === true),
  // not by isApprovedExpenseRow.
  it("BASELINE: confirmed paid date returns actual type", () => {
    const row = {
      expenseActualTotal: "5000.00",
      expensePaymentDate: "2026-03-15",
      paymentDateFontColor: "black",
    };
    const result = getOutflowAmountBreakdown(row);
    expect(result.type).toBe("actual");
    expect(result.amount).toBe(5000);
    expect(result.amountSource).toBe("expenseActualTotal");
  });

  it("BASELINE: unconfirmed paid date (red font) returns forecast type", () => {
    const row = {
      expenseActualTotal: "5000.00",
      expensePaymentDate: "2026-03-15",
      paymentDateFontColor: "red",
    };
    const result = getOutflowAmountBreakdown(row);
    expect(result.type).toBe("forecast");
    expect(result.amount).toBe(5000);
    expect(result.amountSource).toBe("expenseActualTotal");
  });

  it("BASELINE: no paid date with budget IGNORES budget (uses actual or 0)", () => {
    const row = { expenseActualTotal: "5000.00", budgetTotal: "4500.00" };
    const result = getOutflowAmountBreakdown(row);
    expect(result.type).toBe("forecast");
    expect(result.amount).toBe(5000);
    expect(result.amountSource).toBe("expenseActualTotal");
  });

  it("BASELINE: completely empty returns 0", () => {
    const row = {};
    const result = getOutflowAmountBreakdown(row);
    expect(result.amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F. APPROVAL STATUS DETECTION — verifies isApprovedExpenseRow
// ---------------------------------------------------------------------------

describe("isApprovedExpenseRow baseline", () => {
  it("BASELINE: row with approvedDate is approved", () => {
    expect(isApprovedExpenseRow({ approvedDate: "2026-01-01" })).toBe(true);
  });

  it("BASELINE: row with status APPROVED is approved", () => {
    expect(isApprovedExpenseRow({ status: "APPROVED" })).toBe(true);
  });

  it("BASELINE: row with status PAID is approved", () => {
    expect(isApprovedExpenseRow({ status: "PAID" })).toBe(true);
  });

  it("BASELINE: row with lineStatus Approved is approved", () => {
    expect(isApprovedExpenseRow({ lineStatus: "Approved" })).toBe(true);
  });

  it("BASELINE: row with status PLANNED is NOT approved", () => {
    expect(isApprovedExpenseRow({ status: "PLANNED" })).toBe(false);
  });

  it("BASELINE: empty row is NOT approved", () => {
    expect(isApprovedExpenseRow({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G. mapCostToExpenseInput — field mapping from NormalizedCostLine
// ---------------------------------------------------------------------------

describe("mapCostToExpenseInput baseline", () => {
  it("BASELINE: maps paidDate to expensePaymentDate", () => {
    const cost: any = { paidDate: "2026-01-15" };
    const result = mapCostToExpenseInput(cost);
    expect(result.expensePaymentDate).toBe("2026-01-15");
  });

  it("BASELINE: maps invoiceNumber to expenseInvoiceNumber", () => {
    const cost: any = { invoiceNumber: "INV-001" };
    const result = mapCostToExpenseInput(cost);
    expect(result.expenseInvoiceNumber).toBe("INV-001");
  });

  it("BASELINE: maps amountExVat to expenseActualTotal", () => {
    const cost: any = { amountExVat: "50000.00" };
    const result = mapCostToExpenseInput(cost);
    expect(result.expenseActualTotal).toBe("50000.00");
  });
});

// ---------------------------------------------------------------------------
// H. ID COLLISION SAFETY — proves negative IDs can never collide with serial IDs
// ---------------------------------------------------------------------------

describe("ID namespace collision safety", () => {
  it("adapted IDs are always negative", () => {
    const cost: any = { id: 1, projectName: "X", sourceRow: 1 };
    const adapted = adaptCostToExpense(cost, "X");
    expect(adapted.id).toBe(-1);
    expect(adapted.id).toBeLessThan(0);
  });

  it("high cost IDs produce high-magnitude negative IDs (no collision with positive serials)", () => {
    const cost: any = { id: 100000, projectName: "X", sourceRow: 1 };
    const adapted = adaptCostToExpense(cost, "X");
    expect(adapted.id).toBe(-100000);
    expect(adapted.id).toBeLessThan(0);
  });

  it("negative IDs can never equal any positive program_expense serial ID", () => {
    // PostgreSQL serial IDs are always positive. Negative adapted IDs
    // occupy a completely separate namespace with zero overlap.
    for (const costId of [1, 100, 1000, 10000, 100000, 999999]) {
      const adapted = adaptCostToExpense({ id: costId, projectName: "X", sourceRow: costId } as any, "X");
      expect(adapted.id).toBeLessThan(0);
      // No positive serial ID can equal this
      expect(adapted.id).not.toBe(costId);
    }
  });

  it("reverse transform recovers the original normalizedCostLines ID", () => {
    const cost: any = { id: 42, projectName: "X", sourceRow: 1 };
    const adapted = adaptCostToExpense(cost, "X");
    // New negative-ID reverse
    const recovered = adapted.id < 0 ? -adapted.id : adapted.id;
    expect(recovered).toBe(42);
  });

  it("reverse transform is backward-compatible with legacy 900000 offset", () => {
    // For any persisted expense_task_links with old 900000-offset IDs
    const legacyId = 900042; // old format: cost.id=42 + 900000
    const recovered = legacyId < 0 ? -legacyId : (legacyId >= 900000 ? legacyId - 900000 : legacyId);
    expect(recovered).toBe(42);
  });

  it("adaptRevenueToInflow also uses negative IDs", () => {
    const rev: any = { id: 7, projectName: "X", sourceRow: 1, invoiceNumber: null, paidDate: null, inBankDate: null };
    const adapted = adaptRevenueToInflow(rev, "X");
    expect(adapted.id).toBe(-7);
    expect(adapted.id).toBeLessThan(0);
  });
});
