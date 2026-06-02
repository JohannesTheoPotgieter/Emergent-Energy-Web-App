/**
 * DF-22 — Unit tests for `bucketCostLinesForRecognition`.
 *
 * This is the canonical in-memory bucketing helper used by every monthly-
 * report route (/api/program/cos, /api/gp-tracker, /api/revenue-tracker,
 * lifecycle, COS Tracker). Before this test it was only exercised via
 * full integration chains; a regression in the filter list (non-item,
 * zero amount, missing COS date) or in the `_Tracker` suffix stripping
 * would silently drift monthly aggregates across 10+ routes.
 *
 * The helper is pure — no DB calls — so the tests run as pure data
 * functions.
 */
import { describe, it, expect, vi } from "vitest";
import { bucketCostLinesForRecognition } from "../../../server/lib/finance/recognition-bucketing";

// The helper delegates to recognitionAmountFor + getCosEffectiveDateAndSource
// + isCosRealised. We exercise the surface contract — filters, monthKey,
// suffix strip — without re-testing every downstream predicate.
function expenseRow(over: Record<string, any> = {}): any {
  return {
    rowType: "item",
    expenseActualTotal: 1000,
    expenseInvoicedDate: "2026-04-15",
    expensePaymentDate: null,
    expenseInvoiceNumber: "INV-001",
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
    revenueRecognitionAmount: 1500,
    projectName: "Project Alpha",
    cosStatusOverride: null,
    cosRealised: null,
    expensePoNumber: "PO-1",
    ...over,
  };
}

const CURRENT_MONTH_KEY = "2026-05";

describe("bucketCostLinesForRecognition — DF-22 filter and bucketing", () => {
  it("filters non-item rows (subtotal, header, summary)", () => {
    const rows = [
      expenseRow({ rowType: "item" }),
      expenseRow({ rowType: "subtotal" }),
      expenseRow({ rowType: "header" }),
      expenseRow({ rowType: null }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result).toHaveLength(1);
    expect(result[0].exp.rowType).toBe("item");
  });

  it("filters zero-amount rows (no COS to recognise)", () => {
    const rows = [
      expenseRow({ expenseActualTotal: 1000 }),
      expenseRow({ expenseActualTotal: 0 }),
      expenseRow({ expenseActualTotal: "0" }),
      expenseRow({ expenseActualTotal: null }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(1000);
  });

  it("filters rows with no COS effective date (cannot be bucketed)", () => {
    const rows = [
      expenseRow({ expenseInvoicedDate: "2026-04-15" }),
      expenseRow({
        expenseInvoicedDate: null,
        expensePaymentDate: null,
        expenseInvoiceNumber: null,
      }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => !!r.monthKey)).toBe(true);
  });

  it("extracts YYYY-MM month key from the effective COS date", () => {
    const rows = [
      expenseRow({ expenseInvoicedDate: "2026-04-15" }),
      expenseRow({ expenseInvoicedDate: "2026-05-01" }),
      expenseRow({ expenseInvoicedDate: "2025-12-31" }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result.map((r) => r.monthKey)).toEqual(["2026-04", "2026-05", "2025-12"]);
  });

  it("strips `_Tracker` suffix from project names (case-insensitive)", () => {
    const rows = [
      expenseRow({ projectName: "Coega_Tracker" }),
      expenseRow({ projectName: "Mondi_tracker" }),
      expenseRow({ projectName: "Plain Project" }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result.map((r) => r.projectName)).toEqual(["Coega", "Mondi", "Plain Project"]);
  });

  it("propagates revenueAmount from recognitionAmountFor (persisted col U)", () => {
    const rows = [
      expenseRow({ revenueRecognitionAmount: 2500 }),
      expenseRow({ revenueRecognitionAmount: 0 }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result[0].revenueAmount).toBe(2500);
    expect(result[1].revenueAmount).toBe(0);
  });

  it("classifies cosRealised true for in-current-month invoice with BLACK + invoice", () => {
    const result = bucketCostLinesForRecognition(
      [
        expenseRow({
          expenseInvoicedDate: "2026-05-10",
          invoiceDateFontColor: "black",
          invoiceDateConfirmed: true,
          expenseInvoiceNumber: "INV-RR",
        }),
      ],
      { currentMonthKey: "2026-05" },
    );
    expect(result[0].cosRealised).toBe(true);
  });

  it("classifies cosRealised FALSE for past-month lines with a RED invoice date (no auto-promote)", () => {
    // Owner decision 2026-06 (C1): realisation is colour-gated for ALL months.
    // A closed-month line whose invoice date is RED stays Committed — it is NOT
    // auto-promoted to realised just because the month has passed.
    const result = bucketCostLinesForRecognition(
      [
        expenseRow({
          expenseInvoicedDate: "2026-04-10",
          invoiceDateFontColor: "red",
          invoiceDateConfirmed: false,
          expenseInvoiceNumber: "INV-PAST",
        }),
      ],
      { currentMonthKey: "2026-05" },
    );
    expect(result[0].cosRealised).toBe(false);
  });

  it("classifies cosRealised TRUE for past-month lines with a BLACK invoice date", () => {
    const result = bucketCostLinesForRecognition(
      [
        expenseRow({
          expenseInvoicedDate: "2026-04-10",
          invoiceDateFontColor: "black",
          invoiceDateConfirmed: true,
          expenseInvoiceNumber: "INV-PAST-BLACK",
        }),
      ],
      { currentMonthKey: "2026-05" },
    );
    expect(result[0].cosRealised).toBe(true);
  });

  it("classifies cosRealised false for future-month lines (boundary guard)", () => {
    const result = bucketCostLinesForRecognition(
      [
        expenseRow({
          expenseInvoicedDate: "2026-09-01",
          invoiceDateFontColor: "black",
          invoiceDateConfirmed: true,
        }),
      ],
      { currentMonthKey: "2026-05" },
    );
    expect(result[0].cosRealised).toBe(false);
  });

  it("returns empty list when all rows are filtered", () => {
    const rows = [
      expenseRow({ rowType: "subtotal" }),
      expenseRow({ expenseActualTotal: 0 }),
    ];
    const result = bucketCostLinesForRecognition(rows, {
      currentMonthKey: CURRENT_MONTH_KEY,
    });
    expect(result).toEqual([]);
  });
});
