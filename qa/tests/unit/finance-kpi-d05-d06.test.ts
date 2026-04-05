/**
 * D-05 & D-06 verification tests — Financial KPI differentiation and COS alignment.
 *
 * D-05: fin_revenue_vs_target must differ from fin_cash_collected_vs_target.
 *        Revenue uses isRevenueSettled() (broad), Cash uses isCashInBank() (strict).
 *
 * D-06: COS "realised" must use isCanonicalCosRealised() consistently across views.
 */
import { describe, it, expect } from "vitest";
import { isRevenueSettled, isCashInBank } from "../../../server/lib/finance/revenue-ar-status";
import { isCanonicalCosRealised } from "../../../server/lib/finance/cos-realisation";

describe("D-05: Revenue Settled vs Cash In Bank differentiation", () => {
  it("status 'paid' is settled but NOT cash in bank", () => {
    const input = { status: "paid", paidDate: null, inBankDate: null };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(false);
  });

  it("status 'received' is settled but NOT cash in bank", () => {
    const input = { status: "received" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(false);
  });

  it("status 'in_bank' is both settled AND cash in bank", () => {
    const input = { status: "in_bank" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("status 'in bank' (with space) is both settled AND cash in bank", () => {
    const input = { status: "in bank" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("inBankDate present makes both settled AND cash in bank", () => {
    const input = { inBankDate: "2026-03-15" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("paidDate with confirmedPaid is both settled AND cash in bank", () => {
    const input = { paidDate: "2026-03-15", paidDateConfirmed: true };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("paidDate with black font color is both settled AND cash in bank", () => {
    const input = { paidDate: "2026-03-15", paidDateFontColor: "#000000" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("paidDate alone (no confirmation) is settled but NOT cash in bank", () => {
    const input = { paidDate: "2026-03-15" };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(false);
  });

  it("manualInBank flag makes it cash in bank", () => {
    const input = { manualInBank: true };
    expect(isRevenueSettled(input)).toBe(true);
    expect(isCashInBank(input)).toBe(true);
  });

  it("empty input is neither settled nor cash in bank", () => {
    const input = {};
    expect(isRevenueSettled(input)).toBe(false);
    expect(isCashInBank(input)).toBe(false);
  });
});

describe("D-06: Canonical COS Realised logic", () => {
  const today = "2026-04-05";

  it("explicit override 'COS Realised' => realised", () => {
    expect(isCanonicalCosRealised({ cosStatusOverride: "COS Realised", today })).toBe(true);
  });

  it("explicit override 'REALISED' => realised", () => {
    expect(isCanonicalCosRealised({ cosStatusOverride: "REALISED", today })).toBe(true);
  });

  it("explicit override 'PLANNED' blocks realisation", () => {
    expect(isCanonicalCosRealised({
      cosStatusOverride: "PLANNED",
      status: "COS Realised",
      today,
    })).toBe(false);
  });

  it("status 'COS REALISED' => realised (no override)", () => {
    expect(isCanonicalCosRealised({ status: "COS REALISED", today })).toBe(true);
  });

  it("status 'INVOICED' => realised", () => {
    expect(isCanonicalCosRealised({ status: "INVOICED", today })).toBe(true);
  });

  it("status 'PAID' => realised", () => {
    expect(isCanonicalCosRealised({ status: "PAID", today })).toBe(true);
  });

  it("cosRealised boolean true => realised", () => {
    expect(isCanonicalCosRealised({ cosRealised: true, today })).toBe(true);
  });

  it("committed with PO + past-month invoice date => realised", () => {
    expect(isCanonicalCosRealised({
      status: "COMMITTED",
      expensePoNumber: "PO-123",
      expenseInvoicedDate: "2026-02-15", // past month
      today,
    })).toBe(true);
  });

  it("committed with PO + current-month invoice date => NOT realised", () => {
    expect(isCanonicalCosRealised({
      status: "COMMITTED",
      expensePoNumber: "PO-123",
      expenseInvoicedDate: "2026-04-01", // current month
      today,
    })).toBe(false);
  });

  it("has invoice number + past-month date => realised", () => {
    expect(isCanonicalCosRealised({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-03-20",
      today,
    })).toBe(true);
  });

  it("has invoice number but no date => NOT realised", () => {
    expect(isCanonicalCosRealised({
      expenseInvoiceNumber: "INV-001",
      today,
    })).toBe(false);
  });

  it("planned item (no signals) => NOT realised", () => {
    expect(isCanonicalCosRealised({ today })).toBe(false);
  });

  it("paidDate field used as fallback committed date", () => {
    expect(isCanonicalCosRealised({
      expensePoNumber: "PO-456",
      paymentDate: "2026-01-10",
      today,
    })).toBe(true);
  });
});
