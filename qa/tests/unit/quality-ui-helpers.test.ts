/**
 * Task 3.3 / 3.4 — shared Quality UI helpers.
 *
 * Behavioural tests for the consolidated getRiskSeverityColor and the
 * date-only formatter (parses as local midnight to match the overdue logic).
 */
import { describe, expect, it } from "vitest";
import { getRiskSeverityColor, formatDateOnly } from "../../../client/src/lib/quality-ui-helpers";

describe("getRiskSeverityColor", () => {
  it("maps severity levels to distinct classes (case-insensitive)", () => {
    expect(getRiskSeverityColor("High")).toContain("red");
    expect(getRiskSeverityColor("critical")).toContain("red");
    expect(getRiskSeverityColor("medium")).toContain("amber");
    expect(getRiskSeverityColor("major")).toContain("amber");
    expect(getRiskSeverityColor("low")).toContain("yellow");
    expect(getRiskSeverityColor("minor")).toContain("yellow");
  });

  it("falls back to muted for unknown severities", () => {
    expect(getRiskSeverityColor("")).toContain("muted");
    expect(getRiskSeverityColor("bogus")).toContain("muted");
  });
});

describe("formatDateOnly", () => {
  it("parses a YYYY-MM-DD as local midnight (no off-by-one)", () => {
    // Local-midnight parse means the rendered day equals the input day
    // regardless of timezone.
    const expected = new Date(2026, 0, 15).toLocaleDateString();
    expect(formatDateOnly("2026-01-15")).toBe(expected);
    expect(formatDateOnly("2026-01-15T00:00:00Z")).toBe(expected);
  });

  it("returns empty string for nullish input", () => {
    expect(formatDateOnly(null)).toBe("");
    expect(formatDateOnly(undefined)).toBe("");
    expect(formatDateOnly("")).toBe("");
  });
});
