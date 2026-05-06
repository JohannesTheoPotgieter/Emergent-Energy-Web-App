/**
 * Unit tests for the QB precedence merge logic.
 *
 * These cover the pure function `mergeQbValues` — no database, no
 * import pipeline, just the rules:
 *   1. Unlinked rows pass through unchanged
 *   2. Linked rows lock amount / VAT / invoice number / dates to QB
 *   3. QB Paid status auto-realises cost lines
 *   4. Variances are logged in the audit trail
 *   5. Admin overrides survive on top of QB-locked values
 *   6. Revenue lines never auto-realise (only cost lines do)
 */

import { describe, it, expect } from "vitest";
import {
  mergeQbValues,
  type QbLinkSnapshot,
  type QbDocSnapshot,
} from "../../../server/lib/import/qb-precedence";

const baseLink: QbLinkSnapshot = {
  id: 101,
  qbEntityType: "bill",
  qbEntityId: "qb-bill-1",
  qbRealmId: "realm-1",
  qbDocNumber: "INV-6572",
  qbTxnDate: "2026-03-15",
  qbAmount: "82141.00",
  qbCounterpartyName: "Matriarch Pty Ltd",
};

const baseDoc: QbDocSnapshot = {
  id: 201,
  qbEntityType: "bill",
  qbEntityId: "qb-bill-1",
  qbRealmId: "realm-1",
  qbDocNumber: "INV-6572",
  qbTxnDate: "2026-03-15",
  qbAmountExVat: "82141.00",
  qbTaxAmount: "12321.15",
  qbAmountIncVat: "94462.15",
  qbBalance: "94462.15",
  qbPaymentStatus: "unpaid",
};

describe("mergeQbValues — unlinked rows", () => {
  it("passes proposed values through unchanged when there is no link", () => {
    const proposed = {
      amountExVat: "999.00",
      invoiceNumber: "INV-XYZ",
      invoiceDate: "2026-01-01",
      cosRealised: false,
      description: "Random",
    };
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: proposed,
      link: null,
      doc: null,
    });
    expect(result.isLinked).toBe(false);
    expect(result.lockedFields).toEqual([]);
    expect(result.autoRealised).toBe(false);
    expect(result.variances).toEqual([]);
    expect(result.finalValues).toEqual(proposed);
  });
});

describe("mergeQbValues — linked rows lock to QB values", () => {
  it("overrides workbook amount when it differs from QB by more than R0.01", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82000.00",       // workbook is wrong
        invoiceNumber: "INV-6572",     // workbook agrees
        invoiceDate: "2026-03-15",
        description: "Solar panel batch 12",
        cosRealised: true,             // workbook says realised; doc is unpaid → variance
      },
      link: baseLink,
      doc: baseDoc,
    });
    expect(result.isLinked).toBe(true);
    expect(result.finalValues.amountExVat).toBe("82141.00");
    expect(result.finalValues.invoiceNumber).toBe("INV-6572");
    expect(result.finalValues.description).toBe("Solar panel batch 12"); // not locked
    const amountVar = result.variances.find((v) => v.field === "amountExVat");
    expect(amountVar).toBeDefined();
    expect(amountVar?.resolution).toBe("qb_locked");
    expect(amountVar?.workbookValue).toBe("82000.00");
    expect(amountVar?.qbValue).toBe("82141.00");
  });

  it("locks invoice number even on a one-character typo (INV6572 vs INV-6572)", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82141.00",
        invoiceNumber: "INV6572",     // missing hyphen
        invoiceDate: "2026-03-15",
      },
      link: baseLink,
      doc: baseDoc,
    });
    expect(result.finalValues.invoiceNumber).toBe("INV-6572");
    const v = result.variances.find((x) => x.field === "invoiceNumber");
    expect(v).toBeDefined();
    expect(v?.workbookValue).toBe("INV6572");
    expect(v?.qbValue).toBe("INV-6572");
  });

  it("does not log a variance when workbook and QB agree", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82141",   // numeric vs string — should not be a variance
        invoiceNumber: "INV-6572",
        invoiceDate: "2026-03-15",
        vat: "12321.15",
      },
      link: baseLink,
      doc: baseDoc,
    });
    expect(result.variances.filter((v) => v.field !== "cosRealised")).toEqual([]);
  });

  it("leaves paidDate/inBankDate alone when QB has no opinion (doc has no payment events yet)", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82141.00",
        invoiceNumber: "INV-6572",
        invoiceDate: "2026-03-15",
        paidDate: "2026-04-10",          // workbook value preserved
        inBankDate: "2026-04-12",
      },
      link: baseLink,
      doc: baseDoc,
    });
    expect(result.finalValues.paidDate).toBe("2026-04-10");
    expect(result.finalValues.inBankDate).toBe("2026-04-12");
  });
});

describe("mergeQbValues — auto-realisation from QB payment", () => {
  it("auto-realises a cost line when QB doc has zero balance", () => {
    const paidDoc: QbDocSnapshot = { ...baseDoc, qbBalance: "0.00", qbPaymentStatus: "paid" };
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82141.00",
        invoiceNumber: "INV-6572",
        invoiceDate: "2026-03-15",
        cosRealised: false,           // workbook says not realised
      },
      link: baseLink,
      doc: paidDoc,
    });
    expect(result.autoRealised).toBe(true);
    expect(result.finalValues.cosRealised).toBe(true);
    const v = result.variances.find((x) => x.field === "cosRealised");
    expect(v?.resolution).toBe("auto_realised");
  });

  it("auto-realises on status='Paid' even when balance is missing", () => {
    const paidDoc: QbDocSnapshot = { ...baseDoc, qbBalance: null, qbPaymentStatus: "Paid" };
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: { amountExVat: "82141.00", cosRealised: false },
      link: baseLink,
      doc: paidDoc,
    });
    expect(result.finalValues.cosRealised).toBe(true);
  });

  it("does NOT auto-realise revenue lines (only cost lines)", () => {
    const paidDoc: QbDocSnapshot = { ...baseDoc, qbBalance: "0.00", qbPaymentStatus: "paid" };
    const result = mergeQbValues({
      appEntityType: "revenue_line",
      proposedValues: { amountExVat: "82141.00" },
      link: baseLink,
      doc: paidDoc,
    });
    expect(result.autoRealised).toBe(false);
    expect(result.finalValues.cosRealised).toBeUndefined();
  });

  it("does NOT auto-realise when QB still shows a balance owing", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: { amountExVat: "82141.00", cosRealised: false },
      link: baseLink,
      doc: baseDoc, // unpaid
    });
    expect(result.autoRealised).toBe(false);
    expect(result.finalValues.cosRealised).toBe(false);
  });

  it("does not double-log when workbook already says cosRealised=true and QB agrees", () => {
    const paidDoc: QbDocSnapshot = { ...baseDoc, qbBalance: "0.00", qbPaymentStatus: "paid" };
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: { amountExVat: "82141.00", cosRealised: true },
      link: baseLink,
      doc: paidDoc,
    });
    expect(result.autoRealised).toBe(false);
    expect(result.variances.some((v) => v.field === "cosRealised")).toBe(false);
  });
});

describe("mergeQbValues — admin overrides survive QB lock", () => {
  it("preserves adminDateOverride on a QB-locked row (override is a third layer)", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: {
        amountExVat: "82141.00",
        invoiceNumber: "INV-6572",
        invoiceDate: "2026-03-15",
        adminDateOverride: "2026-05-01",
        adminDateOverrideReason: "Shifted to next milestone",
        adminDateOverrideBy: 42,
      },
      link: baseLink,
      doc: baseDoc,
    });
    expect(result.finalValues.adminDateOverride).toBe("2026-05-01");
    expect(result.finalValues.adminDateOverrideReason).toBe("Shifted to next milestone");
    expect(result.finalValues.adminDateOverrideBy).toBe(42);
  });
});

describe("mergeQbValues — number tolerance", () => {
  it("treats 82141.001 and 82141.00 as equal (sub-cent tolerance)", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: { amountExVat: 82141.001 },
      link: baseLink,
      doc: { ...baseDoc, qbAmountExVat: "82141.00" },
    });
    const v = result.variances.find((x) => x.field === "amountExVat");
    expect(v).toBeUndefined();
  });

  it("treats 82141.50 and 82141.00 as different (R0.50 variance is real)", () => {
    const result = mergeQbValues({
      appEntityType: "cost_line",
      proposedValues: { amountExVat: 82141.50 },
      link: baseLink,
      doc: { ...baseDoc, qbAmountExVat: "82141.00" },
    });
    const v = result.variances.find((x) => x.field === "amountExVat");
    expect(v).toBeDefined();
  });
});
