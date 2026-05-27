/**
 * TF-6 (audit V3) — formatZarAriaLabel contract.
 *
 * Pin the spoken form of money values so a future refactor cannot
 * silently regress screen-reader output for finance dashboards.
 */
import { describe, expect, it } from "vitest";
import { formatZarAriaLabel } from "../../../client/src/lib/currency";

describe("TF-6 — formatZarAriaLabel", () => {
  it("emits en-US comma-separated digits + ' rand' suffix for whole numbers", () => {
    expect(formatZarAriaLabel(0)).toBe("0 rand");
    expect(formatZarAriaLabel(1)).toBe("1 rand");
    expect(formatZarAriaLabel(1000)).toBe("1,000 rand");
    expect(formatZarAriaLabel(1234567)).toBe("1,234,567 rand");
  });

  it("prefixes 'negative ' for sub-zero amounts", () => {
    expect(formatZarAriaLabel(-1)).toBe("negative 1 rand");
    expect(formatZarAriaLabel(-1234567)).toBe("negative 1,234,567 rand");
  });

  it("includes cents when cents=true", () => {
    expect(formatZarAriaLabel(0, { cents: true })).toBe("0.00 rand");
    expect(formatZarAriaLabel(1234.5, { cents: true })).toBe("1,234.50 rand");
    expect(formatZarAriaLabel(-99.99, { cents: true })).toBe("negative 99.99 rand");
  });

  it("returns the placeholder for null / undefined / non-numeric input", () => {
    expect(formatZarAriaLabel(null)).toBe("no value");
    expect(formatZarAriaLabel(undefined)).toBe("no value");
    expect(formatZarAriaLabel("not a number")).toBe("no value");
    expect(formatZarAriaLabel(Number.NaN)).toBe("no value");
    expect(formatZarAriaLabel(null, { placeholder: "unset" })).toBe("unset");
  });

  it("parses numeric strings the same way formatZar does", () => {
    expect(formatZarAriaLabel("1234567")).toBe("1,234,567 rand");
    expect(formatZarAriaLabel("-50000")).toBe("negative 50,000 rand");
  });
});
