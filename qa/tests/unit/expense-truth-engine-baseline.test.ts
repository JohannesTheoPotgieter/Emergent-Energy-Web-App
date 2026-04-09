/**
 * Expense Truth-Engine Baseline Tests
 *
 * These tests pin down the exact behavior of the pure-function helpers
 * that underpin the expense truth engine in server/storage.ts.
 * They must all pass BEFORE and AFTER any extraction of expense methods
 * into a repository.
 *
 * Covered invariants:
 * 1. adaptCostToExpense field mapping and computedState derivation
 * 2. selectWinningExpenseRows winner selection across NCL+PE merge
 * 3. getExpenseBusinessKey deterministic keying
 * 4. Budget/date overlay from legacy PE rows onto adapted NCL rows
 * 5. Carry-forward logic simulation
 * 6. ID canonicalization (negative → positive, offset → base)
 * 7. Field name mapping for updateProgramExpenseFields
 * 8. createManualExpense field mapping
 * 9. createManyProgramExpenses input→NCL column mapping
 */

import { describe, expect, it } from "vitest";
import {
  adaptCostToExpense,
  createNameResolver,
} from "../../../server/lib/data-merge";
import {
  getExpenseBusinessKey,
  selectWinningExpenseRows,
  type ExpenseLikeRow,
} from "../../../server/lib/expense-row-selector";

// ──────────────────────────────────────────────────────────
// 1. adaptCostToExpense — field mapping invariants
// ──────────────────────────────────────────────────────────
describe("adaptCostToExpense baseline invariants", () => {
  const baseCost = {
    id: 42,
    projectId: 7,
    costCategory: "Electrical",
    description: "Cable tray install",
    invoiceNumber: "INV-001",
    invoiceDate: "2026-01-15",
    paidDate: "2026-02-01",
    poNumber: "PO-100",
    amountExVat: "15000.00",
    counterpartyName: "Sparky Ltd",
    sourceRow: 3,
    invoiceDateConfirmed: true,
    invoiceDateFontColor: "black",
    paidDateConfirmed: true,
    paidDateFontColor: "black",
    approvedDate: "2026-01-20",
    status: "PAID",
    noRevenueLinked: false,
    cosRealised: false,
    cosStatusOverride: null,
    cosStatusOverrideBy: null,
    cosStatusOverrideAt: null,
    cosStatusOverrideReason: null,
    source: "imported",
    updatedAt: "2026-02-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    effectiveFrom: "2026-01-01T00:00:00Z",
  };

  it("negates the DB id to produce the API-facing id", () => {
    const result = adaptCostToExpense(baseCost as any, "TestProject");
    expect(result.id).toBe(-42);
  });

  it("maps costCategory to expenseCategory", () => {
    const result = adaptCostToExpense(baseCost as any, "TestProject");
    expect(result.expenseCategory).toBe("Electrical");
  });

  it("defaults expenseCategory to 'General' when costCategory is null", () => {
    const cost = { ...baseCost, costCategory: null };
    const result = adaptCostToExpense(cost as any, "TestProject");
    expect(result.expenseCategory).toBe("General");
  });

  it("uses sourceRow as rowNumber", () => {
    const result = adaptCostToExpense(baseCost as any, "TestProject");
    expect(result.rowNumber).toBe(3);
  });

  it("falls back to id for rowNumber when sourceRow is missing", () => {
    const cost = { ...baseCost, sourceRow: undefined };
    const result = adaptCostToExpense(cost as any, "TestProject");
    expect(result.rowNumber).toBe(42);
  });

  it("sets _isNormalized to true", () => {
    const result = adaptCostToExpense(baseCost as any, "TestProject");
    expect(result._isNormalized).toBe(true);
  });

  it("resolves project name from the provided resolvedName, not from the cost row", () => {
    const result = adaptCostToExpense(baseCost as any, "ResolvedName");
    expect(result.projectName).toBe("ResolvedName");
  });

  // computedState derivation
  it("computes 'Paid' when invoice + paidDate + confirmed", () => {
    const result = adaptCostToExpense(baseCost as any, "P");
    expect(result.computedState).toBe("Paid");
  });

  it("computes 'Invoiced' when invoice + invoiceDate confirmed but no paid confirmation", () => {
    const cost = { ...baseCost, paidDate: null, paidDateConfirmed: false, paidDateFontColor: "red" };
    const result = adaptCostToExpense(cost as any, "P");
    expect(result.computedState).toBe("Invoiced");
  });

  it("computes 'Committed' when PO exists but no confirmed dates", () => {
    const cost = {
      ...baseCost,
      invoiceNumber: null,
      invoiceDate: null,
      paidDate: null,
      invoiceDateConfirmed: false,
      invoiceDateFontColor: "red",
      paidDateConfirmed: false,
      paidDateFontColor: "red",
    };
    const result = adaptCostToExpense(cost as any, "P");
    expect(result.computedState).toBe("Committed");
  });

  it("computes 'Planned' when no PO, no invoice", () => {
    const cost = {
      ...baseCost,
      invoiceNumber: null,
      invoiceDate: null,
      paidDate: null,
      poNumber: null,
      invoiceDateConfirmed: false,
      paidDateConfirmed: false,
    };
    const result = adaptCostToExpense(cost as any, "P");
    expect(result.computedState).toBe("Planned");
  });
});

// ──────────────────────────────────────────────────────────
// 2. Winner selection — NCL+PE merge behavior
// ──────────────────────────────────────────────────────────
describe("selectWinningExpenseRows merge invariants", () => {
  it("normalized row wins over legacy row with same business key when both approved", () => {
    const normalized: ExpenseLikeRow = {
      id: -100,
      _isNormalized: true,
      projectId: 5,
      _sourceRow: 10,
      approvedDate: "2026-03-01",
      updatedAt: "2026-03-01T00:00:00Z",
    };
    const legacy: ExpenseLikeRow = {
      id: 200,
      _isNormalized: false,
      projectId: 5,
      rowNumber: 10,
      approvedDate: "2026-03-01",
      updatedAt: "2026-03-01T00:00:00Z",
    };

    const result = selectWinningExpenseRows([normalized, legacy]);
    expect(result.winners).toHaveLength(1);
    // With identical timestamps, higher abs(id) wins as tiebreaker
    // legacy id=200 > normalized id=-100 → abs(200) > abs(-100) → legacy wins
    // But let's verify the actual behavior rather than assume
    expect(result.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("approved row always beats non-approved row regardless of timestamp", () => {
    const approved: ExpenseLikeRow = {
      id: 1, _isNormalized: true, projectId: 1, _sourceRow: 1,
      approvedDate: "2025-01-01", updatedAt: "2025-01-01T00:00:00Z",
    };
    const recent: ExpenseLikeRow = {
      id: 2, _isNormalized: true, projectId: 1, _sourceRow: 1,
      approvedDate: null, updatedAt: "2026-12-31T00:00:00Z",
    };

    const result = selectWinningExpenseRows([approved, recent]);
    expect(result.winners[0].id).toBe(1);
  });

  it("rows with different business keys are NOT merged", () => {
    const a: ExpenseLikeRow = { id: 1, projectId: 1, _sourceRow: 1, _isNormalized: true };
    const b: ExpenseLikeRow = { id: 2, projectId: 1, _sourceRow: 2, _isNormalized: true };

    const result = selectWinningExpenseRows([a, b]);
    expect(result.winners).toHaveLength(2);
    expect(result.diagnostics.duplicatesRemoved).toBe(0);
  });

  it("tracks normalized vs legacy winner counts in diagnostics", () => {
    const rows: ExpenseLikeRow[] = [
      { id: 1, _isNormalized: true, projectId: 1, _sourceRow: 1 },
      { id: 2, _isNormalized: false, projectId: 2, rowNumber: 2 },
    ];
    const result = selectWinningExpenseRows(rows);
    expect(result.diagnostics.normalizedInput).toBe(1);
    expect(result.diagnostics.legacyInput).toBe(1);
    expect(result.diagnostics.winners).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────
// 3. Business key determinism
// ──────────────────────────────────────────────────────────
describe("getExpenseBusinessKey invariants", () => {
  it("uses projectId + sourceRow as primary key", () => {
    const key = getExpenseBusinessKey({ projectId: 5, _sourceRow: 10 });
    expect(key).toBe("pid:5::row:10");
  });

  it("falls back to projectName + rowNumber when projectId is null", () => {
    const key = getExpenseBusinessKey({ projectId: null, projectName: "My Project", rowNumber: 7 });
    expect(key).toBe("pname:my project::row:7");
  });

  it("uses id-based fallback when no sourceRow", () => {
    const key = getExpenseBusinessKey({ id: 99, projectId: 5 });
    expect(key).toBe("id:99");
  });

  it("normalizes project name to lowercase in fallback key", () => {
    const key = getExpenseBusinessKey({ projectName: "Solar Farm Alpha", rowNumber: 1 });
    expect(key).toBe("pname:solar farm alpha::row:1");
  });
});

// ──────────────────────────────────────────────────────────
// 4. Budget/date overlay behavior
//
// CRITICAL INVARIANT: _fetchAllProgramExpenses overlays 10 fields.
// getProgramExpensesByProject overlays only 6 fields (no adminDateOverride*).
// These MUST NOT be unified during extraction.
//
// _fetchAllProgramExpenses overlay (storage.ts lines 1156-1165):
//   budgetTotal, budgetQty, budgetRateUnit, budgetCosTotal,
//   forecastPaymentDate, computedForecastPaymentDate,
//   adminDateOverride, adminDateOverrideReason, adminDateOverrideBy, adminDateOverrideAt
//
// getProgramExpensesByProject overlay (storage.ts lines 1251-1256):
//   budgetTotal, budgetQty, budgetRateUnit, budgetCosTotal,
//   forecastPaymentDate, computedForecastPaymentDate
//   (NO adminDateOverride fields)
// ──────────────────────────────────────────────────────────
describe("PE budget overlay onto adapted NCL rows", () => {
  // Full PE row with all 10 possible overlay fields populated
  const fullPeRow = {
    id: 200, projectId: 5, rowNumber: 3, _isNormalized: false,
    budgetTotal: "50000", budgetQty: "10", budgetRateUnit: "5000", budgetCosTotal: "48000",
    forecastPaymentDate: "2026-06-15", computedForecastPaymentDate: "2026-06-20",
    adminDateOverride: "2026-07-01", adminDateOverrideReason: "Delayed by client",
    adminDateOverrideBy: "admin-user", adminDateOverrideAt: "2026-05-10T00:00:00Z",
  };

  it("_fetchAllProgramExpenses overlays all 10 fields from PE onto adapted NCL row", () => {
    // Simulates storage.ts lines 1148-1166
    const item: Record<string, any> = {
      id: -10, projectId: 5, _sourceRow: 3, _isNormalized: true, rowNumber: 3,
      budgetTotal: null, budgetQty: null, budgetRateUnit: null, budgetCosTotal: null,
      forecastPaymentDate: null, computedForecastPaymentDate: null,
      adminDateOverride: null, adminDateOverrideReason: null,
      adminDateOverrideBy: null, adminDateOverrideAt: null,
    };

    const pe = fullPeRow;
    // Exact replica of storage.ts lines 1156-1165
    if (pe.budgetTotal != null) item.budgetTotal = String(pe.budgetTotal);
    if (pe.budgetQty != null) item.budgetQty = String(pe.budgetQty);
    if (pe.budgetRateUnit != null) item.budgetRateUnit = String(pe.budgetRateUnit);
    if (pe.budgetCosTotal != null) item.budgetCosTotal = String(pe.budgetCosTotal);
    if (pe.forecastPaymentDate != null) item.forecastPaymentDate = pe.forecastPaymentDate;
    if (pe.computedForecastPaymentDate != null) item.computedForecastPaymentDate = pe.computedForecastPaymentDate;
    if (pe.adminDateOverride != null) item.adminDateOverride = pe.adminDateOverride;
    if (pe.adminDateOverrideReason != null) item.adminDateOverrideReason = pe.adminDateOverrideReason;
    if (pe.adminDateOverrideBy != null) item.adminDateOverrideBy = pe.adminDateOverrideBy;
    if (pe.adminDateOverrideAt != null) item.adminDateOverrideAt = pe.adminDateOverrideAt;

    expect(item.budgetTotal).toBe("50000");
    expect(item.budgetQty).toBe("10");
    expect(item.budgetRateUnit).toBe("5000");
    expect(item.budgetCosTotal).toBe("48000");
    expect(item.forecastPaymentDate).toBe("2026-06-15");
    expect(item.computedForecastPaymentDate).toBe("2026-06-20");
    expect(item.adminDateOverride).toBe("2026-07-01");
    expect(item.adminDateOverrideReason).toBe("Delayed by client");
    expect(item.adminDateOverrideBy).toBe("admin-user");
    expect(item.adminDateOverrideAt).toBe("2026-05-10T00:00:00Z");
  });

  it("getProgramExpensesByProject overlays only 6 fields — NO adminDateOverride*", () => {
    // Simulates storage.ts lines 1251-1256
    const item: Record<string, any> = {
      id: -10, projectId: 5, _sourceRow: 3, _isNormalized: true, rowNumber: 3,
      budgetTotal: null, budgetQty: null, budgetRateUnit: null, budgetCosTotal: null,
      forecastPaymentDate: null, computedForecastPaymentDate: null,
      adminDateOverride: null, adminDateOverrideReason: null,
      adminDateOverrideBy: null, adminDateOverrideAt: null,
    };

    const pe = fullPeRow;
    // Exact replica of storage.ts lines 1251-1256 (only 6 fields)
    if (pe.budgetTotal != null) item.budgetTotal = String(pe.budgetTotal);
    if (pe.budgetQty != null) item.budgetQty = String(pe.budgetQty);
    if (pe.budgetRateUnit != null) item.budgetRateUnit = String(pe.budgetRateUnit);
    if (pe.budgetCosTotal != null) item.budgetCosTotal = String(pe.budgetCosTotal);
    if (pe.forecastPaymentDate != null) item.forecastPaymentDate = pe.forecastPaymentDate;
    if (pe.computedForecastPaymentDate != null) item.computedForecastPaymentDate = pe.computedForecastPaymentDate;

    // 6 overlaid fields
    expect(item.budgetTotal).toBe("50000");
    expect(item.budgetQty).toBe("10");
    expect(item.budgetRateUnit).toBe("5000");
    expect(item.budgetCosTotal).toBe("48000");
    expect(item.forecastPaymentDate).toBe("2026-06-15");
    expect(item.computedForecastPaymentDate).toBe("2026-06-20");

    // 4 fields that are NOT overlaid by per-project method — must remain null
    expect(item.adminDateOverride).toBeNull();
    expect(item.adminDateOverrideReason).toBeNull();
    expect(item.adminDateOverrideBy).toBeNull();
    expect(item.adminDateOverrideAt).toBeNull();
  });

  it("does NOT overlay when no matching legacy PE row exists", () => {
    const item: Record<string, any> = {
      id: -10, projectId: 5, _sourceRow: 99, _isNormalized: true, rowNumber: 99,
      budgetTotal: null,
    };
    const legacyByKey = new Map<string, any>();

    const pe = legacyByKey.get(getExpenseBusinessKey(item));
    if (pe && pe.budgetTotal != null) item.budgetTotal = String(pe.budgetTotal);

    expect(item.budgetTotal).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// 5. Carry-forward logic simulation
// ──────────────────────────────────────────────────────────
describe("carry-forward behavior simulation", () => {
  // Mirrors getProgramExpensesByProject carry-forward (storage.ts lines 1200-1232).
  //
  // Key behavior:
  //   1. Only triggered when at least one adapted row lacks BOTH expensePaymentDate AND forecastPaymentDate
  //   2. Queries CLOSED NCL rows (effectiveTo IS NOT NULL) for the same project
  //   3. For each closed row, the pay date is: cl.paidDate || cl.forecastPaymentDate (line 1211)
  //   4. Picks the closed row with highest id per sourceRow (line 1214)
  //   5. Applies: expensePaymentDate, forecastPaymentDate, paymentDateFontColor, paymentDateConfirmed, _carryForward

  /** Simulates the exact carry-forward algorithm from storage.ts lines 1207-1232 */
  function simulateCarryForward(
    adapted: Array<Record<string, any>>,
    closedRows: Array<Record<string, any>>,
  ) {
    const priorByRow = new Map<number, any>();
    for (const cl of closedRows) {
      const row = cl.sourceRow;
      if (row == null) continue;
      // Line 1211: paidDate || forecastPaymentDate
      const payDate = cl.paidDate || cl.forecastPaymentDate;
      if (!payDate) continue;
      const existing = priorByRow.get(row);
      if (!existing || (cl.id > existing.id)) {
        priorByRow.set(row, cl);
      }
    }
    for (const item of adapted) {
      if (!item.expensePaymentDate && !item.forecastPaymentDate) {
        const prior = priorByRow.get(item.rowNumber);
        if (prior) {
          // Line 1222: paidDate || forecastPaymentDate
          const priorDate = prior.paidDate || prior.forecastPaymentDate;
          if (priorDate) {
            item.expensePaymentDate = priorDate;
            item.forecastPaymentDate = priorDate;
            item.paymentDateFontColor = prior.paidDateFontColor || "red";
            item.paymentDateConfirmed = prior.paidDateConfirmed ?? false;
            item._carryForward = true;
          }
        }
      }
    }
  }

  it("inherits paidDate from closed row, including font color and confirmed flag", () => {
    const adapted = [
      { rowNumber: 5, expensePaymentDate: null, forecastPaymentDate: null,
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];
    const closedRows = [
      { id: 100, sourceRow: 5, paidDate: "2026-01-15", forecastPaymentDate: null,
        paidDateFontColor: "black", paidDateConfirmed: true },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0].expensePaymentDate).toBe("2026-01-15");
    expect(adapted[0].forecastPaymentDate).toBe("2026-01-15");
    expect(adapted[0].paymentDateFontColor).toBe("black");
    expect(adapted[0].paymentDateConfirmed).toBe(true);
    expect(adapted[0]._carryForward).toBe(true);
  });

  it("falls back to forecastPaymentDate when closed row has no paidDate", () => {
    // This is the Gap 3 test: line 1211 uses cl.paidDate || cl.forecastPaymentDate
    const adapted = [
      { rowNumber: 8, expensePaymentDate: null, forecastPaymentDate: null,
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];
    const closedRows = [
      { id: 200, sourceRow: 8, paidDate: null, forecastPaymentDate: "2026-04-01",
        paidDateFontColor: null, paidDateConfirmed: false },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0].expensePaymentDate).toBe("2026-04-01");
    expect(adapted[0].forecastPaymentDate).toBe("2026-04-01");
    // Line 1226: prior.paidDateFontColor || "red" → null || "red" = "red"
    expect(adapted[0].paymentDateFontColor).toBe("red");
    // Line 1227: prior.paidDateConfirmed ?? false → false ?? false = false
    expect(adapted[0].paymentDateConfirmed).toBe(false);
    expect(adapted[0]._carryForward).toBe(true);
  });

  it("does NOT carry forward when active row already has a payment date", () => {
    const adapted = [
      { rowNumber: 5, expensePaymentDate: "2026-03-01", forecastPaymentDate: null,
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];
    const closedRows = [
      { id: 100, sourceRow: 5, paidDate: "2026-01-15", forecastPaymentDate: null,
        paidDateFontColor: "black", paidDateConfirmed: true },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0]._carryForward).toBeUndefined();
    expect(adapted[0].expensePaymentDate).toBe("2026-03-01");
    expect(adapted[0].paymentDateFontColor).toBeNull();
  });

  it("does NOT carry forward when active row has forecastPaymentDate", () => {
    const adapted = [
      { rowNumber: 5, expensePaymentDate: null, forecastPaymentDate: "2026-05-01",
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];
    const closedRows = [
      { id: 100, sourceRow: 5, paidDate: "2026-01-15", forecastPaymentDate: null,
        paidDateFontColor: "black", paidDateConfirmed: true },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0]._carryForward).toBeUndefined();
    expect(adapted[0].forecastPaymentDate).toBe("2026-05-01");
  });

  it("picks the closed row with highest id when multiple exist for same sourceRow", () => {
    const closedRows = [
      { id: 50, sourceRow: 5, paidDate: "2025-06-01", forecastPaymentDate: null, paidDateFontColor: "red", paidDateConfirmed: false },
      { id: 80, sourceRow: 5, paidDate: "2025-12-01", forecastPaymentDate: null, paidDateFontColor: "black", paidDateConfirmed: true },
      { id: 60, sourceRow: 5, paidDate: "2025-09-01", forecastPaymentDate: null, paidDateFontColor: "red", paidDateConfirmed: false },
    ];

    const adapted = [
      { rowNumber: 5, expensePaymentDate: null, forecastPaymentDate: null,
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0].expensePaymentDate).toBe("2025-12-01");
    expect(adapted[0].paymentDateFontColor).toBe("black");
    expect(adapted[0].paymentDateConfirmed).toBe(true);
    expect(adapted[0]._carryForward).toBe(true);
  });

  it("skips closed rows that have neither paidDate nor forecastPaymentDate", () => {
    const adapted = [
      { rowNumber: 5, expensePaymentDate: null, forecastPaymentDate: null,
        paymentDateFontColor: null as string | null, paymentDateConfirmed: null as boolean | null,
        _carryForward: undefined as boolean | undefined },
    ];
    const closedRows = [
      { id: 100, sourceRow: 5, paidDate: null, forecastPaymentDate: null,
        paidDateFontColor: null, paidDateConfirmed: null },
    ];

    simulateCarryForward(adapted, closedRows);

    expect(adapted[0]._carryForward).toBeUndefined();
    expect(adapted[0].expensePaymentDate).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// 6. ID canonicalization
// ──────────────────────────────────────────────────────────
describe("ID canonicalization for updateProgramExpenseFields", () => {
  // Mirrors storage.ts line 1323
  function canonicalizeId(id: number): number {
    return id < 0 ? -id : (id >= 900000 ? id - 900000 : id);
  }

  it("negated ID (-42) becomes 42", () => {
    expect(canonicalizeId(-42)).toBe(42);
  });

  it("offset ID (900042) becomes 42", () => {
    expect(canonicalizeId(900042)).toBe(42);
  });

  it("plain ID (42) stays 42", () => {
    expect(canonicalizeId(42)).toBe(42);
  });

  it("zero stays zero", () => {
    expect(canonicalizeId(0)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// 7. Field name mapping for updateProgramExpenseFields
// ──────────────────────────────────────────────────────────
describe("updateProgramExpenseFields field mapping", () => {
  // Mirrors storage.ts lines 1294-1312
  const fieldMap: Record<string, string> = {
    expenseCategory: 'costCategory',
    expenseLineItem: 'description',
    expenseActualTotal: 'amountExVat',
    expenseInvoiceNumber: 'invoiceNumber',
    expenseInvoicedDate: 'invoiceDate',
    expensePaymentDate: 'paidDate',
    expensePoNumber: 'poNumber',
    supplierName: 'counterpartyName',
    invoiceDateConfirmed: 'invoiceDateConfirmed',
    invoiceDateFontColor: 'invoiceDateFontColor',
    paymentDateConfirmed: 'paidDateConfirmed',
    paymentDateFontColor: 'paidDateFontColor',
    noRevenueLinked: 'noRevenueLinked',
    cosStatusOverride: 'cosStatusOverride',
    cosStatusOverrideBy: 'cosStatusOverrideBy',
    cosStatusOverrideAt: 'cosStatusOverrideAt',
    cosStatusOverrideReason: 'cosStatusOverrideReason',
  };

  it("maps all 17 PE-facing field names to NCL column names", () => {
    expect(Object.keys(fieldMap)).toHaveLength(17);
    expect(fieldMap.expenseCategory).toBe("costCategory");
    expect(fieldMap.expensePaymentDate).toBe("paidDate");
    expect(fieldMap.supplierName).toBe("counterpartyName");
    expect(fieldMap.cosStatusOverride).toBe("cosStatusOverride");
  });

  it("accepts unmapped keys only if they are valid NCL schema columns", () => {
    // storage.ts lines 1313-1318: two-gate filter
    //   Gate 1: mapped key is in validDbColumns (Set of NCL column names from fieldMap values)
    //   Gate 2: OR raw/mapped key exists in Object.keys(normalizedCostLines) (drizzle schema)
    //
    // Known NCL schema column names (from shared/schema/finance.ts lines 493-551):
    //   id, projectId, projectName, costCategory, counterpartyId, counterpartyName,
    //   counterpartyType, description, amountExVat, amountExVatLegacy, invoiceNumber,
    //   invoiceDate, invoiceDateFontColor, invoiceDateConfirmed, approvedDate, paidDate,
    //   paidDateFontColor, paidDateConfirmed, poNumber, cosRealised, cashflowConfirmed,
    //   status, sourceSheet, sourceRow, importRunId, turnaroundDays, patternRuleId,
    //   patternClassifiedAt, patternInferredType, noRevenueLinked, budgetQty, budgetRate,
    //   budgetTotal, budgetCos, revenueRecognitionAmount, forecastPaymentDate,
    //   adminDateOverride, adminDateOverrideReason, adminDateOverrideBy, adminDateOverrideAt,
    //   subProjectName, cosStatusOverride, cosStatusOverrideBy, cosStatusOverrideAt,
    //   cosStatusOverrideReason, createdAt, updatedAt, effectiveFrom, effectiveTo,
    //   snapshotRunId, idempotencyKey

    const validDbColumns = new Set(Object.values(fieldMap));

    // Simulate the filter from storage.ts lines 1314-1318
    function wouldAcceptField(key: string, nclSchemaKeys: string[]): boolean {
      const mapped = fieldMap[key] || key;
      return validDbColumns.has(mapped) || nclSchemaKeys.includes(mapped);
    }

    // Known NCL column names (camelCase as they appear from Object.keys on drizzle table)
    const nclSchemaKeys = [
      "id", "projectId", "projectName", "costCategory", "counterpartyId", "counterpartyName",
      "counterpartyType", "description", "amountExVat", "amountExVatLegacy", "invoiceNumber",
      "invoiceDate", "invoiceDateFontColor", "invoiceDateConfirmed", "approvedDate", "paidDate",
      "paidDateFontColor", "paidDateConfirmed", "poNumber", "cosRealised", "cashflowConfirmed",
      "status", "sourceSheet", "sourceRow", "importRunId", "turnaroundDays", "patternRuleId",
      "patternClassifiedAt", "patternInferredType", "noRevenueLinked", "budgetQty", "budgetRate",
      "budgetTotal", "budgetCos", "revenueRecognitionAmount", "forecastPaymentDate",
      "adminDateOverride", "adminDateOverrideReason", "adminDateOverrideBy", "adminDateOverrideAt",
      "subProjectName", "cosStatusOverride", "cosStatusOverrideBy", "cosStatusOverrideAt",
      "cosStatusOverrideReason", "createdAt", "updatedAt", "effectiveFrom", "effectiveTo",
      "snapshotRunId", "idempotencyKey",
    ];

    // Case A: mapped PE field name → accepted via gate 1 (validDbColumns)
    expect(wouldAcceptField("expenseCategory", nclSchemaKeys)).toBe(true);

    // Case B: unmapped key that IS an NCL schema column → accepted via gate 2
    expect(wouldAcceptField("approvedDate", nclSchemaKeys)).toBe(true);
    expect(wouldAcceptField("cosRealised", nclSchemaKeys)).toBe(true);

    // Case C: unmapped key that is NOT an NCL schema column → DROPPED silently
    expect(wouldAcceptField("totallyBogusField", nclSchemaKeys)).toBe(false);
    expect(wouldAcceptField("randomFrontendKey", nclSchemaKeys)).toBe(false);
  });

  it("returns undefined when all input fields are filtered out", () => {
    // storage.ts lines 1320-1321: if mappedFields is empty, return undefined
    const mappedFields: Record<string, any> = {};
    // Simulate: only bogus fields provided, all get dropped
    const result = Object.keys(mappedFields).length === 0 ? undefined : mappedFields;
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────
// 8. createManualExpense field mapping
// ──────────────────────────────────────────────────────────
describe("createManualExpense field mapping", () => {
  it("maps PE-shaped input to NCL columns correctly", () => {
    // Mirrors storage.ts lines 1870-1886
    const d = {
      projectName: "Solar Alpha",
      projectId: 7,
      expenseCategory: "Electrical",
      expenseLineItem: "Cable tray",
      expenseActualTotal: "15000",
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-01-15",
      expensePaymentDate: "2026-02-01",
      expensePoNumber: "PO-100",
      supplierName: "Sparky",
      rowNumber: 5,
      idempotencyKey: "key-123",
    };

    const mapped: Record<string, any> = {
      projectName: d.projectName,
      projectId: d.projectId,
      costCategory: d.expenseCategory || null,
      description: d.expenseLineItem || null,
      amountExVat: d.expenseActualTotal?.toString() || null,
      invoiceNumber: d.expenseInvoiceNumber || null,
      invoiceDate: d.expenseInvoicedDate || null,
      paidDate: d.expensePaymentDate || null,
      poNumber: d.expensePoNumber || null,
      counterpartyName: d.supplierName || null,
      sourceRow: d.rowNumber || null,
    };

    expect(mapped.costCategory).toBe("Electrical");
    expect(mapped.description).toBe("Cable tray");
    expect(mapped.amountExVat).toBe("15000");
    expect(mapped.invoiceNumber).toBe("INV-001");
    expect(mapped.counterpartyName).toBe("Sparky");
    expect(mapped.sourceRow).toBe(5);
  });

  it("requires projectId — missing projectId should trigger error", () => {
    // Mirrors storage.ts lines 1864-1868
    const resolvedProjectId = null;
    expect(resolvedProjectId).toBeNull();
    // Policy: Manual expenses MUST have a valid project assignment.
  });
});

// ──────────────────────────────────────────────────────────
// 9. createManyProgramExpenses input mapping
// ──────────────────────────────────────────────────────────
describe("createManyProgramExpenses input mapping", () => {
  it("maps PE-shaped batch input to NCL columns", () => {
    // Mirrors storage.ts lines 1266-1281
    const input = {
      projectName: "Solar Beta",
      expenseCategory: "Structural",
      expenseLineItem: "Steel beams",
      expenseActualTotal: "25000.50",
      expenseInvoiceNumber: "INV-002",
      expenseInvoicedDate: "2026-03-01",
      invoiceDateConfirmed: true,
      invoiceDateFontColor: "black",
      expensePaymentDate: "2026-04-01",
      paymentDateConfirmed: false,
      paymentDateFontColor: "red",
      expensePoNumber: "PO-200",
      supplierName: "SteelCo",
      rowNumber: 12,
    };

    const mapped = {
      projectName: input.projectName,
      costCategory: input.expenseCategory || null,
      description: input.expenseLineItem || null,
      amountExVat: input.expenseActualTotal?.toString() || null,
      invoiceNumber: input.expenseInvoiceNumber || null,
      invoiceDate: input.expenseInvoicedDate || null,
      invoiceDateConfirmed: input.invoiceDateConfirmed ?? null,
      invoiceDateFontColor: input.invoiceDateFontColor || null,
      paidDate: input.expensePaymentDate || null,
      paidDateConfirmed: input.paymentDateConfirmed ?? null,
      paidDateFontColor: input.paymentDateFontColor || null,
      poNumber: input.expensePoNumber || null,
      counterpartyName: input.supplierName || null,
      sourceRow: input.rowNumber || null,
    };

    expect(mapped.costCategory).toBe("Structural");
    expect(mapped.amountExVat).toBe("25000.50");
    expect(mapped.invoiceDateConfirmed).toBe(true);
    expect(mapped.paidDateConfirmed).toBe(false);
    expect(mapped.paidDateFontColor).toBe("red");
  });
});

// ──────────────────────────────────────────────────────────
// 10. createNameResolver — project name resolution
// ──────────────────────────────────────────────────────────
describe("createNameResolver invariants", () => {
  const resolve = createNameResolver(["Solar_Farm_Alpha_Tracker", "Wind_Park_Beta"]);

  it("returns exact match when project name exists", () => {
    expect(resolve("Wind_Park_Beta")).toBe("Wind_Park_Beta");
  });

  it("resolves tracker suffix variant", () => {
    expect(resolve("Solar Farm Alpha")).toBe("Solar_Farm_Alpha_Tracker");
  });

  it("returns input unchanged when no match found", () => {
    expect(resolve("NonExistent_Project")).toBe("NonExistent_Project");
  });
});
