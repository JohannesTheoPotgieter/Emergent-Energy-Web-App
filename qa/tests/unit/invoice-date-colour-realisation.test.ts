/**
 * Invoice-date colour realisation signal (AGENT_GUARDRAILS §3.2 / §3.7, owner
 * rule revised 2026-06): a date is CONFIRMED iff its font is a SHADE OF BLACK
 * (dark and near-neutral) OR there is no explicit colour (default/automatic
 * black — the normal confirmed case). ANY explicitly-resolved non-black colour
 * — including all shades of red, plus blue/green/grey/etc. — is UNCONFIRMED.
 * Unresolvable colours (accent/other theme, malformed) and absent colours are
 * treated as default black = confirmed, so a colour we can't read never flips a
 * cell to unconfirmed.
 *
 *   - classifyFont: shade of black / default / unresolvable → 'black' /
 *     isBlack=true; any resolved non-black colour → 'red' / isBlack=false (the
 *     "red" sentinel means "a colour was applied", not necessarily literal red).
 *   - isCanonicalCosRealised: black/default → realised; any colour → NOT realised.
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

describe("classifyFont — confirmed iff a shade of black; any other colour (incl all reds) unconfirmed", () => {
  it("no explicit colour → default black / confirmed", () => {
    expect(classifyFont(undefined)).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont(null)).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont({})).toEqual({ color: "black", isBlack: true, source: "defaulted" });
    expect(classifyFont({ color: undefined })).toEqual({ color: "black", isBlack: true, source: "defaulted" });
  });

  it("shade of black (pure, near-black, dark grey) → confirmed", () => {
    expect(classifyFont({ color: { argb: "FF000000" } })).toEqual({ color: "black", isBlack: true, source: "read" });
    expect(classifyFont({ color: { argb: "FF202020" } })).toEqual({ color: "black", isBlack: true, source: "read" });
    expect(classifyFont({ color: { theme: 1 } })).toEqual({ color: "black", isBlack: true, source: "read" });
  });

  it("every shade of red → unconfirmed", () => {
    expect(classifyFont({ color: { argb: "FFFF0000" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // bright red
    expect(classifyFont({ color: { argb: "FF800000" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // maroon / dark red
    expect(classifyFont({ color: { argb: "FFFF8080" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // pinkish red
  });

  it("any other applied colour (blue/green/mid-grey) → unconfirmed", () => {
    expect(classifyFont({ color: { argb: "FF0000FF" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // blue
    expect(classifyFont({ color: { argb: "FF008000" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // green
    expect(classifyFont({ color: { argb: "FF808080" } })).toEqual({ color: "red", isBlack: false, source: "read" }); // mid grey
  });

  it("unresolvable accent theme → treated as default black / confirmed (never flip on a colour we can't read)", () => {
    expect(classifyFont({ color: { theme: 5 } })).toEqual({ color: "black", isBlack: true, source: "defaulted" });
  });
});

describe("COS realisation respects the colour signal", () => {
  it("default/black colour → realised", () => {
    const f = classifyFont(undefined);
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(true);
  });

  it("explicit shade of black → realised", () => {
    const f = classifyFont({ color: { argb: "FF000000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(true);
  });

  it("red colour → NOT realised", () => {
    const f = classifyFont({ color: { argb: "FFFF0000" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(false);
  });

  it("blue colour (any non-black) → NOT realised", () => {
    const f = classifyFont({ color: { argb: "FF0000FF" } });
    const realised = isCanonicalCosRealised(
      cosLine({ invoiceDateFontColor: f.color, invoiceDateConfirmed: f.isBlack }),
    );
    expect(realised).toBe(false);
  });
});
