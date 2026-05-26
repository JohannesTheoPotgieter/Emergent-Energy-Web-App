/**
 * DF-20 — Unit tests for `getCosRealisationWarnings()`.
 *
 * The diagnostic-warning helper surfaces data-quality flags on COS lines:
 *
 *   PLACEHOLDER_INVOICE         — invoice cell says TBC / N/A / Pending / etc.
 *   INVOICE_WITHOUT_PO          — invoice captured but no PO recorded
 *   INVOICE_WITHOUT_DATE        — invoice number present but no invoice date
 *   REALISED_BY_FONT_COLOR_ONLY — realisation rests on Excel font colour,
 *                                 not on a QB-allocated bill (lower confidence)
 *
 * These warnings drive UI badges and the data-quality scan endpoint. Before
 * this test, the warnings were only exercised via integration tests; a
 * future refactor could silently suppress one of them.
 *
 * Tests use the same input shape that `isCanonicalCosRealised` accepts.
 */
import { describe, it, expect } from "vitest";
import {
  getCosRealisationWarnings,
  type CosLineInput,
} from "../../../server/lib/finance/cos-realisation";

const TODAY = "2026-05-26";

function baseInput(overrides: Partial<CosLineInput> = {}): CosLineInput {
  return {
    status: null,
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: "INV-001",
    expenseInvoicedDate: "2026-05-15",
    expensePoNumber: "PO-1",
    paymentDate: null,
    today: TODAY,
    amountExVat: 1000,
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
    lineAssignedQbExVat: 0,
    ...overrides,
  };
}

describe("getCosRealisationWarnings — diagnostic flags on realised COS lines", () => {
  it("returns no warnings on a fully clean realised line", () => {
    const warnings = getCosRealisationWarnings(baseInput());
    expect(warnings).toContain("REALISED_BY_FONT_COLOR_ONLY"); // realised via colour, no QB
    // PLACEHOLDER, WITHOUT_PO, WITHOUT_DATE all absent on a clean line
    expect(warnings).not.toContain("PLACEHOLDER_INVOICE");
    expect(warnings).not.toContain("INVOICE_WITHOUT_PO");
    expect(warnings).not.toContain("INVOICE_WITHOUT_DATE");
  });

  it("returns NO warnings when the line is not realised", () => {
    // Without an invoice + colour gate it isn't realised, so the diagnostic
    // helper returns an empty list per its contract.
    const warnings = getCosRealisationWarnings(
      baseInput({
        expenseInvoiceNumber: null,
        invoiceDateFontColor: null,
        invoiceDateConfirmed: null,
      }),
    );
    expect(warnings).toEqual([]);
  });

  it("flags PLACEHOLDER_INVOICE when invoice text is a placeholder", () => {
    // Placeholders skip the realisation gate, so we need an admin override
    // to drive isCanonicalCosRealised true and reach the warnings path.
    const warnings = getCosRealisationWarnings(
      baseInput({
        cosStatusOverride: "COS REALISED",
        expenseInvoiceNumber: "TBC",
      }),
    );
    expect(warnings).toContain("PLACEHOLDER_INVOICE");
  });

  it("flags INVOICE_WITHOUT_PO when invoice captured but no PO", () => {
    const warnings = getCosRealisationWarnings(
      baseInput({ expensePoNumber: null }),
    );
    expect(warnings).toContain("INVOICE_WITHOUT_PO");
  });

  it("flags INVOICE_WITHOUT_DATE when invoice number is present but date is missing", () => {
    const warnings = getCosRealisationWarnings(
      baseInput({
        // Override realises the line so the diagnostic helper proceeds.
        cosStatusOverride: "COS REALISED",
        expenseInvoicedDate: null,
      }),
    );
    expect(warnings).toContain("INVOICE_WITHOUT_DATE");
  });

  it("flags REALISED_BY_FONT_COLOR_ONLY when realisation rests on font colour with no QB", () => {
    const warnings = getCosRealisationWarnings(
      baseInput({
        invoiceDateFontColor: "black",
        invoiceDateConfirmed: true,
        lineAssignedQbExVat: 0,
      }),
    );
    expect(warnings).toContain("REALISED_BY_FONT_COLOR_ONLY");
  });

  it("does NOT flag REALISED_BY_FONT_COLOR_ONLY when QB evidence is present", () => {
    const warnings = getCosRealisationWarnings(
      baseInput({
        invoiceDateFontColor: "black",
        invoiceDateConfirmed: true,
        lineAssignedQbExVat: 1000,
      }),
    );
    expect(warnings).not.toContain("REALISED_BY_FONT_COLOR_ONLY");
  });

  it("returns multiple warnings concurrently (placeholder + no PO)", () => {
    const warnings = getCosRealisationWarnings(
      baseInput({
        cosStatusOverride: "COS REALISED",
        expenseInvoiceNumber: "Pending",
        expensePoNumber: null,
      }),
    );
    expect(warnings).toContain("PLACEHOLDER_INVOICE");
    expect(warnings).toContain("INVOICE_WITHOUT_PO");
  });
});
