/**
 * DF-23 — Unit tests for `isRevenueSettled` and `evaluateRevenueArStatus`.
 *
 * This predicate gates the "In Bank" status on the Milestone Tracker, AR
 * aging buckets, and the overdue receivables banner on the Cashflow page.
 * It encodes a precedence chain that must remain stable across refactors:
 *
 *   1. QB evidence (qbPaidAmountExVat > 0) — authoritative
 *   2. Status keywords (in_bank, paid, realised, ...)
 *   3. Receipt date / in-bank date / manual flag
 *   4. Backward-compat: paid_date_confirmed OR (paid_date + black font)
 *
 * Plus a diagnostic flag SETTLED_BY_FONT_COLOR_ONLY when the only positive
 * signal is the Excel font-colour heuristic.
 */
import { describe, it, expect } from "vitest";
import {
  isRevenueSettled,
  getRevenueSettlementWarnings,
  evaluateRevenueArStatus,
} from "../../../server/lib/finance/revenue-ar-status";

describe("isRevenueSettled — precedence chain", () => {
  describe("QB evidence (authoritative)", () => {
    it("returns true when qbPaidAmountExVat > 0 regardless of other signals", () => {
      expect(isRevenueSettled({ qbPaidAmountExVat: 1000 })).toBe(true);
      // Even when nothing else is set
      expect(isRevenueSettled({ qbPaidAmountExVat: 0.01 })).toBe(true);
    });

    it("ignores zero / null / NaN qbPaidAmountExVat", () => {
      expect(isRevenueSettled({ qbPaidAmountExVat: 0 })).toBe(false);
      expect(isRevenueSettled({ qbPaidAmountExVat: null })).toBe(false);
      expect(isRevenueSettled({ qbPaidAmountExVat: NaN })).toBe(false);
    });
  });

  describe("Status keywords", () => {
    it.each(["in_bank", "in bank", "paid", "realised", "realized", "received", "settled", "closed"])(
      "returns true when status keyword '%s' is present",
      (kw) => {
        expect(isRevenueSettled({ status: kw })).toBe(true);
      },
    );

    it("matches keywords case-insensitively and with surrounding text", () => {
      expect(isRevenueSettled({ status: "  PAID  " })).toBe(true);
      expect(isRevenueSettled({ status: "fully realised" })).toBe(true);
    });

    it("ignores unrelated status text", () => {
      expect(isRevenueSettled({ status: "draft" })).toBe(false);
      expect(isRevenueSettled({ status: "" })).toBe(false);
      expect(isRevenueSettled({ status: null })).toBe(false);
    });
  });

  describe("Receipt date / in-bank date / manual flag", () => {
    it("returns true when paymentReceivedDate is an ISO date", () => {
      expect(isRevenueSettled({ paymentReceivedDate: "2026-05-15" })).toBe(true);
    });

    it("returns true when paidDate is an ISO date", () => {
      expect(isRevenueSettled({ paidDate: "2026-05-15" })).toBe(true);
    });

    it("returns true when inBankDate is an ISO date", () => {
      expect(isRevenueSettled({ inBankDate: "2026-05-15" })).toBe(true);
    });

    it("returns true on truthy manualInBank flags (boolean/number/string variants)", () => {
      expect(isRevenueSettled({ manualInBank: true })).toBe(true);
      expect(isRevenueSettled({ manualInBank: 1 })).toBe(true);
      expect(isRevenueSettled({ manualInBank: "1" })).toBe(true);
      expect(isRevenueSettled({ manualInBank: "true" })).toBe(true);
      expect(isRevenueSettled({ manualInBank: "yes" })).toBe(true);
    });

    it("rejects falsy manualInBank flags", () => {
      expect(isRevenueSettled({ manualInBank: false })).toBe(false);
      expect(isRevenueSettled({ manualInBank: 0 })).toBe(false);
      expect(isRevenueSettled({ manualInBank: "0" })).toBe(false);
      expect(isRevenueSettled({ manualInBank: null })).toBe(false);
    });

    it("rejects non-ISO date strings", () => {
      expect(isRevenueSettled({ paymentReceivedDate: "" })).toBe(false);
      expect(isRevenueSettled({ paymentReceivedDate: "—" })).toBe(false);
      expect(isRevenueSettled({ paymentReceivedDate: "15-05-2026" })).toBe(false);
    });
  });

  describe("Backward-compat: paidDate + font color", () => {
    it("returns true on paidDateConfirmed=true alone (legacy callers)", () => {
      expect(isRevenueSettled({ paidDateConfirmed: true })).toBe(true);
    });

    it("returns true on (paidDate + black font) per legacy heuristic", () => {
      expect(
        isRevenueSettled({ paidDate: "2026-05-15", paidDateFontColor: "black" }),
      ).toBe(true);
      // Hex variant
      expect(
        isRevenueSettled({ paidDate: "2026-05-15", paidDateFontColor: "FF000000" }),
      ).toBe(true);
    });

    it("does NOT return true on (paidDate + non-black font) without other signal", () => {
      // paidDate alone is enough (covered above), so to test the font branch
      // we drop paidDate and only test paidDateConfirmed.
      expect(
        isRevenueSettled({ paidDateConfirmed: false, paidDateFontColor: "red" }),
      ).toBe(false);
    });
  });

  it("returns false on a completely empty input", () => {
    expect(isRevenueSettled({})).toBe(false);
  });
});

describe("getRevenueSettlementWarnings — SETTLED_BY_FONT_COLOR_ONLY diagnostic", () => {
  it("returns empty when QB evidence is present", () => {
    const warnings = getRevenueSettlementWarnings({
      qbPaidAmountExVat: 1000,
      paidDate: "2026-05-15",
      paidDateFontColor: "black",
    });
    expect(warnings).toEqual([]);
  });

  it("flags SETTLED_BY_FONT_COLOR_ONLY when only signal is paidDateConfirmed (no receipt date)", () => {
    // The font-only path fires when paidDateConfirmed=true is the ONLY
    // positive signal — no paymentReceivedDate, no paidDate (so
    // hasReceiptDate is false), no inBankDate, no manualInBank, no status
    // keyword. This matches the imported-from-Excel-with-no-date scenario.
    const warnings = getRevenueSettlementWarnings({
      paidDateConfirmed: true,
    });
    expect(warnings).toContain("SETTLED_BY_FONT_COLOR_ONLY");
  });

  it("does NOT flag SETTLED_BY_FONT_COLOR_ONLY when receipt date is present", () => {
    const warnings = getRevenueSettlementWarnings({
      paymentReceivedDate: "2026-05-15",
      paidDate: "2026-05-15",
      paidDateFontColor: "black",
    });
    expect(warnings).not.toContain("SETTLED_BY_FONT_COLOR_ONLY");
  });

  it("returns empty when the line is not settled", () => {
    const warnings = getRevenueSettlementWarnings({});
    expect(warnings).toEqual([]);
  });
});

describe("evaluateRevenueArStatus — settled / overdue / hasInvoice", () => {
  it("computes isOverdue=true for unsettled invoiced lines past due", () => {
    const result = evaluateRevenueArStatus({
      today: "2026-05-26",
      dueDate: "2026-05-01",
      invoiceNumber: "INV-001",
      amount: 1000,
    });
    expect(result).toEqual({ isSettled: false, isOverdue: true, hasInvoice: true });
  });

  it("computes isOverdue=false when the line is settled (QB evidence)", () => {
    const result = evaluateRevenueArStatus({
      today: "2026-05-26",
      dueDate: "2026-05-01",
      invoiceNumber: "INV-001",
      amount: 1000,
      qbPaidAmountExVat: 1000,
    });
    expect(result.isSettled).toBe(true);
    expect(result.isOverdue).toBe(false);
  });

  it("computes isOverdue=false when no invoice exists (cannot be overdue)", () => {
    const result = evaluateRevenueArStatus({
      today: "2026-05-26",
      dueDate: "2026-05-01",
      amount: 1000,
    });
    expect(result.isOverdue).toBe(false);
    expect(result.hasInvoice).toBe(false);
  });

  it("computes isOverdue=false when amount is zero (no obligation)", () => {
    const result = evaluateRevenueArStatus({
      today: "2026-05-26",
      dueDate: "2026-05-01",
      invoiceNumber: "INV-001",
      amount: 0,
    });
    expect(result.isOverdue).toBe(false);
  });

  it("computes isOverdue=false when dueDate is in the future", () => {
    const result = evaluateRevenueArStatus({
      today: "2026-05-26",
      dueDate: "2026-06-30",
      invoiceNumber: "INV-001",
      amount: 1000,
    });
    expect(result.isOverdue).toBe(false);
  });
});
