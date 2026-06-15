/**
 * Colour realisation signal (AGENT_GUARDRAILS §3.2 / §3.7, owner rule L1
 * reaffirmed 2026-06): a date is "unconfirmed" ONLY when its font is EXPLICITLY
 * red. Every other state — absent colour (default/automatic black, the normal
 * confirmed case), an unresolvable hex, an accent/other theme colour — collapses
 * to the CONFIRMED black signal. This reverts the earlier
 * `fix/colour-default-not-realised` deviation that wrongly filed default-black
 * (and unresolvable) dates as NOT realised, which booked confirmed lines as
 * Committed and under-stated Realised across every finance surface.
 *
 *   - classifyFont: absent/unresolvable/theme colour → 'black' / isBlack=true /
 *     source='defaulted'; explicit black → 'black'/read; explicit red →
 *     'red'/not black/read.
 *   - isCanonicalCosRealised: default/unresolvable colour → realised; explicit
 *     black → realised; explicit red → NOT realised.
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

describe("classifyFont — only explicit RED is unconfirmed; everything else is confirmed black", () => {
  it("no font → confirmed black (source defaulted)", () => {
    expect(classifyFont(undefined)).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont(null)).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont({})).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont({ color: undefined })).toEqual({ color: "black", isBlack: true, source: "defaulted" });
  });

  it("unresolvable accent theme → confirmed black (not red, so confirmed)", () => {
    expect(classifyFont({ color: { theme: 5 } })).toEqual({ color: "black", isBlack: true, source: "defaulted" });
  });

  it("explicit black (argb or window-text theme) → read / black", () => {
    expect(classifyFont({ color: { argb: "FF000000" } })).toEqual({ color: "black", isBlack: true, source: "read" });
    expect(classifyFont({ color: { theme: 1 } })).toEqual({ color: "black", isBlack: true, source: "read" });
  });

  it("explicit red → read / not black", () => {
    expect(classifyFont({ color: { argb: "FFFF0000" } })).toEqual({ color: "red", isBlack: false, source: "read" });
  });
});

describe("COS realisation respects the colour signal", () => {
  it("default/unreadable colour → realised (only red blocks realisation)", () => {
    const f = classifyFont(undefined); // { color: 'black', isBlack: true, source: 'defaulted' }
    expect(f.source).toBe("defaulted"); // provenance still recorded for diagnostics
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(true);
  });

  it("explicitly black colour → realised", () => {
    const f = classifyFont({ color: { argb: "FF000000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(true);
  });

  it("explicitly red colour → NOT realised", () => {
    const f = classifyFont({ color: { argb: "FFFF0000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(false);
  });
});
