/**
 * Revenue raise ≠ revenue realised
 *
 * Pins the canonical business rule that *issuing* a revenue invoice does
 * NOT make that revenue "realised" / "settled" for cashflow or AR-closed
 * purposes. Settlement only happens once payment evidence (in-bank date,
 * payment receipt date, manual in-bank flag, settled status keyword, or
 * QB-paid evidence) is present.
 *
 * This guards against any future regression where the raise flow flips a
 * line straight to realised on creation.
 */

import { describe, expect, it } from "vitest";
import {
  isRevenueSettled,
  type RevenueSettlementInput,
} from "../../../server/lib/finance/revenue-ar-status";

describe("Revenue raise vs revenue realised", () => {
  describe("Raising an invoice (no payment evidence) is NOT settled", () => {
    it("freshly raised invoice with only invoice metadata is not settled", () => {
      const input: RevenueSettlementInput = {
        status: "issued",
      };
      expect(isRevenueSettled(input)).toBe(false);
    });

    it("invoice with status 'invoiced' is not settled", () => {
      expect(isRevenueSettled({ status: "invoiced" })).toBe(false);
    });

    it("invoice with status 'sent' is not settled", () => {
      expect(isRevenueSettled({ status: "sent" })).toBe(false);
    });

    it("invoice with empty / null status is not settled", () => {
      expect(isRevenueSettled({ status: null })).toBe(false);
      expect(isRevenueSettled({ status: "" })).toBe(false);
      expect(isRevenueSettled({})).toBe(false);
    });

    it("QB qbPaidAmountExVat = 0 does not settle on its own", () => {
      expect(isRevenueSettled({ qbPaidAmountExVat: 0 })).toBe(false);
    });

    it("status alone of 'draft' / 'pending' / 'awaiting payment' is NOT settled", () => {
      expect(isRevenueSettled({ status: "draft" })).toBe(false);
      expect(isRevenueSettled({ status: "pending" })).toBe(false);
      expect(isRevenueSettled({ status: "awaiting payment" })).toBe(false);
    });
  });

  describe("Settlement only happens once payment evidence lands", () => {
    it("paymentReceivedDate is present → settled", () => {
      expect(isRevenueSettled({ paymentReceivedDate: "2026-02-01" })).toBe(true);
    });

    it("inBankDate is present → settled", () => {
      expect(isRevenueSettled({ inBankDate: "2026-02-01" })).toBe(true);
    });

    it("manualInBank = true → settled", () => {
      expect(isRevenueSettled({ manualInBank: true })).toBe(true);
      expect(isRevenueSettled({ manualInBank: "yes" })).toBe(true);
    });

    it("QB qbPaidAmountExVat > 0 → settled (authoritative)", () => {
      expect(isRevenueSettled({ qbPaidAmountExVat: 1000 })).toBe(true);
    });

    it("status keyword 'paid' / 'settled' / 'in_bank' / 'received' / 'realised' → settled", () => {
      for (const s of ["paid", "settled", "in_bank", "received", "realised"]) {
        expect(isRevenueSettled({ status: s })).toBe(true);
      }
    });

    it("paidDate + black font color → settled (legacy Excel signal)", () => {
      expect(
        isRevenueSettled({
          paidDate: "2026-02-01",
          paidDateFontColor: "000000",
        }),
      ).toBe(true);
    });
  });

  describe("Lifecycle: raise → settle transition", () => {
    it("transitions from not-settled to settled only when payment evidence is added", () => {
      // Step 1: invoice raised — no payment evidence.
      const raised: RevenueSettlementInput = {
        status: "issued",
      };
      expect(isRevenueSettled(raised)).toBe(false);

      // Step 2: payment receipt recorded — now settled.
      const paid: RevenueSettlementInput = {
        ...raised,
        paymentReceivedDate: "2026-03-01",
      };
      expect(isRevenueSettled(paid)).toBe(true);
    });

    it("QB sync brings qbPaidAmountExVat — flips to settled", () => {
      const raised: RevenueSettlementInput = { status: "invoiced" };
      expect(isRevenueSettled(raised)).toBe(false);

      const qbSettled: RevenueSettlementInput = {
        ...raised,
        qbPaidAmountExVat: 1500,
      };
      expect(isRevenueSettled(qbSettled)).toBe(true);
    });
  });
});
