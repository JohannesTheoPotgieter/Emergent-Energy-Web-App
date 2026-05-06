import { describe, expect, it } from "vitest";
import { formatNextMilestoneSummary, isNextMilestoneSummary } from "@/lib/next-milestone";

describe("next milestone formatting", () => {
  it("formats the exact regression object shape without crashing", () => {
    const value = { name: "Final Snag Closeout", date: "2026-03-10", allPaid: false };

    expect(isNextMilestoneSummary(value)).toBe(true);
    expect(formatNextMilestoneSummary(value)).toEqual({
      label: "Final Snag Closeout",
      dateLabel: "10 Mar 2026",
      allPaid: false,
    });
  });

  it("shows all-paid summary with no date", () => {
    const value = { name: "Ignored", date: null, allPaid: true };
    expect(formatNextMilestoneSummary(value)).toEqual({
      label: "All Paid ✓",
      dateLabel: null,
      allPaid: true,
    });
  });

  it("returns a safe fallback for malformed object values", () => {
    const malformed = { name: "Revenue", date: { raw: "2026-03-10" }, allPaid: "no" };
    expect(isNextMilestoneSummary(malformed)).toBe(false);
    expect(formatNextMilestoneSummary(malformed)).toEqual({
      label: "Milestone unavailable",
      dateLabel: null,
      allPaid: false,
    });
  });

  it("returns configured fallback label for null values", () => {
    expect(formatNextMilestoneSummary(null, { fallbackLabel: "Not set" })).toEqual({
      label: "Not set",
      dateLabel: null,
      allPaid: false,
    });
  });
});
