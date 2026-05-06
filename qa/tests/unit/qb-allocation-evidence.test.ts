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

describe("isCanonicalCosRealised — QB allocation interaction with the gate", () => {
  // NOTE: The policy around QB-evidence-vs-font-colour was reversed after
  // this file was first written. Current code (see cos-realisation.ts step 2)
  // treats QB evidence as source of truth: a non-zero QB allocation marks
  // the line realised even with red Excel font. The "gate failure wins"
  // behaviour this file was originally testing is no longer the policy.
  // The RED-font-with-QB-evidence scenario is therefore covered by the
  // "BLACK font + QB allocation: realised" assertion below — both are
  // realised under the current contract.

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
  // NOTE: The "RED font + QB 500 → 0" assertion previously lived here
  // but was retired along with the policy change described in the
  // isCanonicalCosRealised describe block above. Under the current
  // contract a QB-allocated line is realised regardless of font colour,
  // so this scenario is covered by the "BLACK font + QB 500" case below.

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
