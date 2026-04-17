/**
 * PR #660 follow-up — allocation + invoice-gate interaction.
 *
 * Proves that QB evidence refines the realised AMOUNT but does NOT bypass
 * the admin override or the invoice-date-confirmed gate. See
 * cos-realisation.ts for the policy rationale.
 */
import { describe, expect, it } from "vitest";
import { isCanonicalCosRealised } from "../../../server/lib/finance/cos-realisation";
import {
  getCosRealisedAmountExVat,
  getCosRealisedAmountForNclRow,
} from "../../../server/lib/calculations/financeUtils";

const baseGateInput = {
  status: null,
  cosStatusOverride: null,
  cosRealised: null,
  expenseInvoiceNumber: "INV-001",
  expenseInvoicedDate: "2026-04-10",
  expensePoNumber: "PO-1",
  paymentDate: null,
  today: "2026-04-16",
  amountExVat: 1000,
  lineAmountExVat: 1000,
} as const;

const baseNclRow = {
  amountExVat: 1000,
  invoiceNumber: "INV-001",
  invoiceDate: "2026-04-10",
  poNumber: "PO-1",
  invoiceDateConfirmed: false,
  cosStatusOverride: null,
  cosRealised: null,
} as const;

describe("isCanonicalCosRealised — QB allocation does not bypass the gate", () => {
  it("RED font + QB allocation: NOT realised (gate failure wins)", () => {
    expect(
      isCanonicalCosRealised({
        ...baseGateInput,
        invoiceDateFontColor: "red",
        invoiceDateConfirmed: false,
        lineAssignedQbExVat: 500,
      }),
    ).toBe(false);
  });

  it("BLACK font + QB allocation: realised", () => {
    expect(
      isCanonicalCosRealised({
        ...baseGateInput,
        invoiceDateFontColor: "black",
        invoiceDateConfirmed: true,
        lineAssignedQbExVat: 500,
      }),
    ).toBe(true);
  });

  it("admin PLANNED override beats QB allocation + BLACK font", () => {
    expect(
      isCanonicalCosRealised({
        ...baseGateInput,
        cosStatusOverride: "PLANNED",
        invoiceDateFontColor: "black",
        invoiceDateConfirmed: true,
        lineAssignedQbExVat: 500,
      }),
    ).toBe(false);
  });

  it("admin COS REALISED override wins even without invoice", () => {
    expect(
      isCanonicalCosRealised({
        ...baseGateInput,
        expenseInvoiceNumber: null,
        cosStatusOverride: "COS REALISED",
        invoiceDateFontColor: "red",
        invoiceDateConfirmed: false,
        lineAssignedQbExVat: null,
      }),
    ).toBe(true);
  });
});

describe("getCosRealisedAmountExVat — amount follows gate, capped by QB evidence", () => {
  it("RED font + QB 500: 0 (not gate-realised)", () => {
    expect(
      getCosRealisedAmountForNclRow(
        { ...baseNclRow, invoiceDateFontColor: "red" },
        500,
      ),
    ).toBe(0);
  });

  it("BLACK font + no QB allocation: full line amount (1000)", () => {
    expect(
      getCosRealisedAmountForNclRow(
        { ...baseNclRow, invoiceDateFontColor: "black" },
        null,
      ),
    ).toBe(1000);
  });

  it("BLACK font + QB 500: min(line, QB) = 500", () => {
    expect(
      getCosRealisedAmountForNclRow(
        { ...baseNclRow, invoiceDateFontColor: "black" },
        500,
      ),
    ).toBe(500);
  });

  it("BLACK font + QB 1500 (over): capped at line amount (1000)", () => {
    expect(
      getCosRealisedAmountForNclRow(
        { ...baseNclRow, invoiceDateFontColor: "black" },
        1500,
      ),
    ).toBe(1000);
  });

  it("Admin COS REALISED override with no invoice: full line amount", () => {
    expect(
      getCosRealisedAmountForNclRow(
        {
          ...baseNclRow,
          invoiceNumber: null,
          invoiceDate: null,
          cosStatusOverride: "COS REALISED",
        },
        null,
      ),
    ).toBe(1000);
  });

  it("Zero line amount: 0 regardless of gate or QB", () => {
    expect(
      getCosRealisedAmountForNclRow(
        { ...baseNclRow, amountExVat: 0, invoiceDateFontColor: "black" },
        500,
      ),
    ).toBe(0);
  });

  it("Legacy cosRealised flag alone: full line amount", () => {
    expect(
      getCosRealisedAmountForNclRow(
        {
          ...baseNclRow,
          invoiceNumber: null,
          invoiceDate: null,
          cosRealised: true,
        },
        null,
      ),
    ).toBe(1000);
  });
});

describe("getCosRealisedAmountExVat — direct shape", () => {
  it("accepts the flat input shape used by adapted expense rows", () => {
    const realised = getCosRealisedAmountExVat({
      amountExVat: 2000,
      expenseInvoiceNumber: "INV-002",
      expenseInvoicedDate: "2026-03-15",
      expensePoNumber: "PO-2",
      invoiceDateFontColor: "black",
      invoiceDateConfirmed: true,
      cosStatusOverride: null,
      cosRealised: null,
      lineAssignedQbExVat: 750,
    });
    expect(realised).toBe(750);
  });
});
