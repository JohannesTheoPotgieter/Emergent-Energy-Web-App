/**
 * DF-29 — Unit tests for `pastOrTodayIsoDate` validator.
 *
 * Per § 3.7 / F-5 from PR #943: paidDate and inBankDate are actuals; a
 * future value belongs in forecastPaymentDate / expectedPaymentDate. The
 * Zod refinement is the route-boundary defence against manual edits that
 * would corrupt aging / DSO / "Realised today" totals.
 *
 * Wired into /api/finance/cost-lines and /api/finance/revenue-lines via
 * server/routes/finance-legacy-extracted-routes.ts.
 */
import { describe, it, expect } from "vitest";
import { pastOrTodayIsoDate } from "../../../server/lib/finance/validators";

describe("pastOrTodayIsoDate — DF-29 future-date rejection", () => {
  const validator = pastOrTodayIsoDate("paidDate");
  const todayIso = new Date().toISOString().slice(0, 10);

  it("accepts today's ISO date", () => {
    const result = validator.safeParse(todayIso);
    expect(result.success).toBe(true);
  });

  it("accepts a date in the past", () => {
    const result = validator.safeParse("2024-01-15");
    expect(result.success).toBe(true);
  });

  it("rejects a date in the future", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const result = validator.safeParse(tomorrow);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("cannot be in the future");
      expect(result.error.issues[0].message).toContain("forecastPaymentDate");
    }
  });

  it("rejects a far-future date", () => {
    const result = validator.safeParse("2099-12-31");
    expect(result.success).toBe(false);
  });

  it("accepts an empty string (treated as not provided)", () => {
    const result = validator.safeParse("");
    expect(result.success).toBe(true);
  });

  it("accepts an ISO datetime by slicing to the date prefix", () => {
    const result = validator.safeParse("2024-01-15T12:00:00.000Z");
    expect(result.success).toBe(true);
  });

  it("rejects non-string input (Zod type-check)", () => {
    expect(validator.safeParse(null).success).toBe(false);
    expect(validator.safeParse(undefined).success).toBe(false);
    expect(validator.safeParse(123).success).toBe(false);
  });

  it("error message names the field", () => {
    const validator2 = pastOrTodayIsoDate("inBankDate");
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const result = validator2.safeParse(tomorrow);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("inBankDate");
    }
  });
});
