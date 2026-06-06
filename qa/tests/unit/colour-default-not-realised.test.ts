/**
 * fix/colour-default-not-realised — an unreadable/defaulted invoice-date colour
 * must be treated as NOT realised (and flagged), never silently realised as
 * black (AGENT_GUARDRAILS §3.2 / §3.7; owner-approved change).
 *
 *   - classifyFont: unresolvable colour → 'unknown' / isBlack=false /
 *     source='defaulted' (the import warning trigger); explicit black/red read.
 *   - isCanonicalCosRealised: 'unknown' colour → NOT realised; explicit black →
 *     realised; explicit red → NOT realised.
 */

import { describe, expect, it } from "vitest";

import { classifyFont } from "../../../server/lib/import/normalizer";
import { isCanonicalCosRealised, type CosLineInput } from "../../../server/lib/finance/cos-realisation";

function cosLine(overrides: Partial<CosLineInput>): CosLineInput {
  return {
    status: null,
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: "INV-1",
    expenseInvoicedDate: null, // null → future-month guard is skipped
    expensePoNumber: null,
    paymentDate: null,
    today: "2026-06-06",
    amountExVat: 1000,
    invoiceDateFontColor: null,
    invoiceDateConfirmed: null,
    lineAssignedQbExVat: null,
    ...overrides,
  };
}

describe("classifyFont — unreadable colour is UNKNOWN/defaulted, never silently black", () => {
  it("no font → unknown / defaulted / not black", () => {
    expect(classifyFont(undefined)).toEqual({ color: "unknown", isBlack: false, source: "defaulted" });
    expect(classifyFont(null)).toEqual({ color: "unknown", isBlack: false, source: "defaulted" });
    expect(classifyFont({})).toEqual({ color: "unknown", isBlack: false, source: "defaulted" });
    expect(classifyFont({ color: undefined })).toEqual({ color: "unknown", isBlack: false, source: "defaulted" });
  });

  it("unresolvable accent theme → unknown / defaulted (no longer assumed black)", () => {
    expect(classifyFont({ color: { theme: 5 } })).toEqual({ color: "unknown", isBlack: false, source: "defaulted" });
  });

  it("explicit black (argb or window-text theme) → read / black", () => {
    expect(classifyFont({ color: { argb: "FF000000" } })).toEqual({ color: "black", isBlack: true, source: "read" });
    expect(classifyFont({ color: { theme: 1 } })).toEqual({ color: "black", isBlack: true, source: "read" });
  });

  it("explicit red → read / not black", () => {
    expect(classifyFont({ color: { argb: "FFFF0000" } })).toEqual({ color: "red", isBlack: false, source: "read" });
  });
});

describe("COS realisation respects the new colour signal", () => {
  it("unreadable colour (unknown) → NOT realised", () => {
    const f = classifyFont(undefined); // { color: 'unknown', isBlack: false, source: 'defaulted' }
    expect(f.source).toBe("defaulted"); // → import warning is emitted for this line
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(false);
  });

  it("explicitly black colour → still realised", () => {
    const f = classifyFont({ color: { argb: "FF000000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(true);
  });

  it("explicitly red colour → stays NOT realised", () => {
    const f = classifyFont({ color: { argb: "FFFF0000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(false);
  });
});
