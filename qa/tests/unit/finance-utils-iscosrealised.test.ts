/**
 * Pins the financeUtils `isCosRealised` wrapper behaviour after the
 * 2026-05 COO ruling that R0 invoiced lines must NOT be realised
 * ("nothing to realise"). The wrapper now forwards `expenseActualTotal`
 * (or `amountExVat` on raw NCL rows) to the canonical's zero-amount
 * gate; before this change the wrapper deliberately dropped the field
 * so the gate never fired and zero-amount lines silently counted as
 * realised.
 *
 * This file complements the canonical-side tests in
 * `qa/tests/unit/smart-import-category-finance.test.ts:S07` (which pin
 * the gate inside `isCanonicalCosRealised`). The two together form a
 * back-to-back contract:
 *   canonical: rejects zero-amount when supplied
 *   wrapper:   supplies the zero-amount field so the rejection fires
 */

import { describe, expect, it } from "vitest";
import { isCosRealised } from "../../../server/lib/calculations/financeUtils";

describe("isCosRealised wrapper — zero-amount gate alignment", () => {
  const realisedRow = {
    expenseInvoiceNumber: "INV-001",
    expenseInvoicedDate: "2026-05-01",
    expensePoNumber: "PO-100",
    expenseActualTotal: "1000.00",
  };

  it("invoice + non-zero expenseActualTotal => realised", () => {
    expect(isCosRealised(realisedRow)).toBe(true);
  });

  it("invoice + zero expenseActualTotal => NOT realised (COO 2026-05)", () => {
    expect(isCosRealised({ ...realisedRow, expenseActualTotal: "0" })).toBe(false);
  });

  it("invoice + zero numeric expenseActualTotal => NOT realised", () => {
    expect(isCosRealised({ ...realisedRow, expenseActualTotal: 0 })).toBe(false);
  });

  it("invoice + zero amountExVat (raw NCL shape) => NOT realised", () => {
    // Raw NCL rows expose the amount as `amountExVat`. The wrapper
    // forwards it as a secondary source after `expenseActualTotal`.
    const rawNclRow: { expenseInvoiceNumber: string; amountExVat: string } = {
      expenseInvoiceNumber: "INV-001",
      amountExVat: "0",
    };
    expect(isCosRealised(rawNclRow)).toBe(false);
  });

  it("invoice + missing amount => realised (legacy contract, no gate)", () => {
    // When neither `expenseActualTotal` nor `amountExVat` is supplied,
    // the canonical's gate skips and the legacy invoice-only rule applies.
    // This keeps callers on the old contract working without forcing
    // every consumer to thread an amount through.
    const noAmountRow = {
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-05-01",
    };
    expect(isCosRealised(noAmountRow)).toBe(true);
  });

  it("placeholder invoice + non-zero amount => NOT realised (placeholder rule)", () => {
    // Sanity check: the zero-amount gate doesn't override the placeholder
    // rule.
    expect(isCosRealised({ ...realisedRow, expenseInvoiceNumber: "TBC" })).toBe(false);
  });
});
