/**
 * Regression — § 3.7 HARD: paidDate is an actuals field.
 *
 * Before this fix, when the paid_date cell was blank the normalizer
 * copied forecast_payment_date into paidDate AND stamped the forecast
 * cell's font colour onto paidDateConfirmed. Combined with the
 * cashflowConfirmed = invoiceNumber && poNumber && paidDateConfirmed
 * formula, a forecast-only row with a black forecast cell flipped to
 * "cashflow confirmed" without any actual payment.
 *
 * These tests lock the post-fix behaviour: paidDate / paidDateConfirmed /
 * cashflowConfirmed only respond to the actual-payment-date column.
 */

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { extractCostLines } from "../../../server/lib/import/normalizer";
import { worksheetToArray } from "../../../server/lib/import/utils";
import type { MappingResult } from "../../../server/lib/import/mapper";

const HEADERS = [
  "Category",
  "Description",
  "Amount Ex VAT",
  "Invoice Number",
  "Invoice Date",
  "Payment Date",
  "PO Number",
  "Forecast Payment Date",
];

const RED_ARGB = { argb: "FFFF0000" };
const BLACK_ARGB = { argb: "FF000000" };

function makeMapping(): MappingResult {
  return {
    section: "EXPENDITURE",
    mappings: [
      { colIndex: 0, rawHeader: "Category", canonicalField: "cost_category", confidence: 1, matchType: "exact" },
      { colIndex: 1, rawHeader: "Description", canonicalField: "description", confidence: 1, matchType: "exact" },
      { colIndex: 2, rawHeader: "Amount Ex VAT", canonicalField: "amount_ex_vat", confidence: 1, matchType: "exact" },
      { colIndex: 3, rawHeader: "Invoice Number", canonicalField: "invoice_number", confidence: 1, matchType: "exact" },
      { colIndex: 4, rawHeader: "Invoice Date", canonicalField: "invoice_date", confidence: 1, matchType: "exact" },
      { colIndex: 5, rawHeader: "Payment Date", canonicalField: "payment_date", confidence: 1, matchType: "exact" },
      { colIndex: 6, rawHeader: "PO Number", canonicalField: "po_number", confidence: 1, matchType: "exact" },
      { colIndex: 7, rawHeader: "Forecast Payment Date", canonicalField: "forecast_payment_date", confidence: 1, matchType: "exact" },
    ],
    unmappedHeaders: [],
    missingRequired: [],
    overallConfidence: 1,
  };
}

interface RowSpec {
  description: string;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  paidDate: Date | null;
  paidDateColor?: "BLACK" | "RED";
  poNumber: string | null;
  forecastPaymentDate: Date | null;
  forecastPaymentDateColor?: "BLACK" | "RED";
}

function buildAndExtract(rows: RowSpec[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("EXPENDITURE");
  ws.addRow(HEADERS);

  for (const r of rows) {
    const xlsxRow = ws.addRow([
      "",
      r.description,
      r.amount,
      r.invoiceNumber ?? "",
      r.invoiceDate ?? "",
      r.paidDate ?? "",
      r.poNumber ?? "",
      r.forecastPaymentDate ?? "",
    ]);
    if (r.paidDateColor) {
      xlsxRow.getCell(6).font = { color: r.paidDateColor === "BLACK" ? BLACK_ARGB : RED_ARGB };
    }
    if (r.forecastPaymentDateColor) {
      xlsxRow.getCell(8).font = { color: r.forecastPaymentDateColor === "BLACK" ? BLACK_ARGB : RED_ARGB };
    }
  }

  const data = worksheetToArray(ws);
  const issues: any[] = [];
  const result = extractCostLines(data, makeMapping(), "EXPENDITURE", 1, data.length, issues, ws);
  return result;
}

describe("normalizer.extractCostLines — § 3.7 paidDate is actuals-only (no forecast fallback)", () => {
  it("forecast-only row with BLACK forecast cell leaves paidDate null and all confirmed flags false", () => {
    const result = buildAndExtract([{
      description: "Forecast-only line",
      amount: 1000,
      invoiceNumber: "INV-001",
      invoiceDate: new Date(Date.UTC(2026, 0, 15)),
      paidDate: null,
      poNumber: "PO-001",
      forecastPaymentDate: new Date(Date.UTC(2026, 1, 15)),
      forecastPaymentDateColor: "BLACK",
    }]);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.paidDate).toBeNull();
    expect(line.paidDateFontColor).toBeNull();
    expect(line.paidDateConfirmed).not.toBe(true);
    expect(line.cashflowConfirmed).toBe(false);
    expect(line.forecastPaymentDate).not.toBeNull();
  });

  it("actual paidDate present with BLACK colour confirms paidDateConfirmed and cashflowConfirmed", () => {
    const result = buildAndExtract([{
      description: "Paid line",
      amount: 1000,
      invoiceNumber: "INV-002",
      invoiceDate: new Date(Date.UTC(2026, 0, 15)),
      paidDate: new Date(Date.UTC(2026, 1, 1)),
      paidDateColor: "BLACK",
      poNumber: "PO-002",
      forecastPaymentDate: null,
    }]);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.paidDate).not.toBeNull();
    expect(line.paidDateConfirmed).toBe(true);
    expect(line.cashflowConfirmed).toBe(true);
  });

  it("actual paidDate present with RED colour keeps paidDateConfirmed and cashflowConfirmed false", () => {
    const result = buildAndExtract([{
      description: "Pending paid line",
      amount: 1000,
      invoiceNumber: "INV-003",
      invoiceDate: new Date(Date.UTC(2026, 0, 15)),
      paidDate: new Date(Date.UTC(2026, 2, 1)),
      paidDateColor: "RED",
      poNumber: "PO-003",
      forecastPaymentDate: null,
    }]);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.paidDate).not.toBeNull();
    expect(line.paidDateConfirmed).toBe(false);
    expect(line.cashflowConfirmed).toBe(false);
  });

  it("forecast-only row with RED forecast cell behaves identically to BLACK forecast", () => {
    const result = buildAndExtract([{
      description: "Forecast-only red",
      amount: 1000,
      invoiceNumber: "INV-004",
      invoiceDate: new Date(Date.UTC(2026, 0, 15)),
      paidDate: null,
      poNumber: "PO-004",
      forecastPaymentDate: new Date(Date.UTC(2026, 3, 1)),
      forecastPaymentDateColor: "RED",
    }]);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.paidDate).toBeNull();
    expect(line.paidDateFontColor).toBeNull();
    expect(line.paidDateConfirmed).not.toBe(true);
    expect(line.cashflowConfirmed).toBe(false);
  });

  it("both paid and forecast set with different dates — actual paidDate wins, forecast colour does not leak", () => {
    const result = buildAndExtract([{
      description: "Paid + forecast different",
      amount: 1000,
      invoiceNumber: "INV-005",
      invoiceDate: new Date(Date.UTC(2026, 0, 15)),
      paidDate: new Date(Date.UTC(2026, 1, 5)),
      paidDateColor: "BLACK",
      poNumber: "PO-005",
      forecastPaymentDate: new Date(Date.UTC(2026, 2, 1)),
      forecastPaymentDateColor: "RED",
    }]);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.paidDate).toBe("2026-02-05");
    expect(line.paidDateConfirmed).toBe(true);
    expect(line.cashflowConfirmed).toBe(true);
    expect(line.forecastPaymentDate).toBe("2026-03-01");
  });

  it("normalizes date-valued text cells to a stable yyyy-mm-dd description", () => {
    const result = buildAndExtract([{
      description: new Date(Date.UTC(2026, 1, 1)) as any,
      amount: 1000,
      invoiceNumber: "INV-006",
      invoiceDate: new Date(Date.UTC(2026, 1, 28)),
      paidDate: new Date(Date.UTC(2026, 2, 7)),
      poNumber: "PO-006",
      forecastPaymentDate: null,
    }]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].description).toBe("2026-02-01");
  });
});
