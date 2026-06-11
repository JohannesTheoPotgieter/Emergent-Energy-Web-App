import { describe, expect, it } from "vitest";
import { formatZar, formatZarCompact, formatZarAriaLabel, formatCount } from "@/lib/currency";

/**
 * Money-format parity / regression guard for the finance compact-template
 * redesign (task constraint #6: "the same displayed figure before and after").
 *
 * <MoneyValue> renders the canonical `formatZar` output verbatim — it only
 * adds alignment + a muted-red class for negatives, never a different digit.
 * These golden strings lock the displayed figures so any future presentation
 * change that silently alters a rendered number fails CI.
 *
 * Strings use plain ASCII spaces because formatZar normalises the en-ZA
 * no-break / narrow-no-break spaces to a regular space (see lib/currency.ts).
 */
describe("finance money formatting — golden displayed figures (locked)", () => {
  it("formats whole-Rand ex-VAT values exactly", () => {
    expect(formatZar(0)).toBe("R 0");
    expect(formatZar(1234567)).toBe("R 1 234 567");
    expect(formatZar(-48250)).toBe("-R 48 250");
    expect(formatZar(999)).toBe("R 999");
    expect(formatZar(8240000)).toBe("R 8 240 000");
  });

  it("renders absent / non-numeric as an em dash, never R 0", () => {
    expect(formatZar(null)).toBe("—");
    expect(formatZar(undefined)).toBe("—");
    expect(formatZar(NaN)).toBe("—");
    expect(formatZar("")).toBe("—");
    // A genuine numeric zero is still R 0 (distinct from "no data").
    expect(formatZar(0)).toBe("R 0");
  });

  it("respects cents + sign options without changing the underlying figure", () => {
    expect(formatZar(1234.5, { cents: true })).toBe("R 1 234,50");
    expect(formatZar(1500, { showSign: true })).toBe("+R 1 500");
    expect(formatZar(-1500, { showSign: true })).toBe("-R 1 500");
  });

  it("compact form (chart axes / dense tiles) is stable", () => {
    expect(formatZarCompact(8240000)).toBe("R8.2M");
    expect(formatZarCompact(1500)).toBe("R2K");
    expect(formatZarCompact(-2300000)).toBe("-R2.3M");
    expect(formatZarCompact(null)).toBe("—");
  });

  it("count formatting is stable", () => {
    expect(formatCount(12)).toBe("12");
    expect(formatCount(1234567)).toBe("1 234 567");
    expect(formatCount(null)).toBe("—");
  });

  it("screen-reader aria-label form is stable (no-break-space-free, spoken)", () => {
    expect(formatZarAriaLabel(1234567)).toBe("1,234,567 rand");
    expect(formatZarAriaLabel(-48250)).toBe("negative 48,250 rand");
    expect(formatZarAriaLabel(null)).toBe("no value");
  });
});
