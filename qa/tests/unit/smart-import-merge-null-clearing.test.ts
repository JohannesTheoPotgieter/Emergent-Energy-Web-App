import { describe, expect, it } from "vitest";

import { resolvedValueOrExisting } from "../../../server/lib/import/commit-executor";

describe("smart import merge write values", () => {
  it("preserves explicit nulls from the workbook instead of falling back to existing values", () => {
    expect(resolvedValueOrExisting({ paidDate: null }, "paidDate", "2026-06-30")).toBeNull();
    expect(resolvedValueOrExisting({ forecastPaymentDate: null }, "forecastPaymentDate", "2026-07-31")).toBeNull();
  });

  it("preserves explicit false booleans from the workbook", () => {
    expect(resolvedValueOrExisting({ paidDateConfirmed: false }, "paidDateConfirmed", true)).toBe(false);
    expect(resolvedValueOrExisting({ cashflowConfirmed: false }, "cashflowConfirmed", true)).toBe(false);
  });

  it("falls back only when the merge result has no value for that field", () => {
    expect(resolvedValueOrExisting({}, "paidDate", "2026-06-30")).toBe("2026-06-30");
  });
});
