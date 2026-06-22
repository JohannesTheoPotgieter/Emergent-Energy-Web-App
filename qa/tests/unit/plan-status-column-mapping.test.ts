import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { mapColumns, planActualPctGap, type MappingResult } from "../../../server/lib/import/mapper";
import type { DetectedSection } from "../../../server/lib/import/detector";

function planSection(headers: string[]): DetectedSection {
  return {
    section: "PLAN",
    sheetName: "PROJECT PLAN",
    headerRowIndex: 8,
    dataStartRowIndex: 10,
    dataEndRowIndex: 60,
    detectedHeaders: headers.map((h, i) => ({
      colIndex: i,
      rawHeader: h,
      normalizedHeader: h.toLowerCase().trim(),
    })),
    confidence: 1,
  };
}

describe("plan import — Status (actual %) column binding", () => {
  it("maps 'Status' → pct_complete and 'Expected Status' → expected_pct (12 Nourse layout)", () => {
    const section = planSection([
      "No.", "High Level Programme", "Planned Start", "Duration", "Planned End",
      "Actual Start", "Duration", "Actual End", "Status", "Expected Status", "Comment",
    ]);
    const result = mapColumns(section, new ExcelJS.Workbook());
    const byField = new Map(result.mappings.map((m) => [m.canonicalField, m.rawHeader]));
    expect(byField.get("pct_complete"), "Status must map to actual %").toBe("Status");
    expect(byField.get("expected_pct"), "Expected Status must map to expected %").toBe("Expected Status");
    // Standard layout binds both → no silent-zero gap.
    expect(planActualPctGap(result)).toBe(false);
  });

  it("recovers actual-% when a stale learned mapping sends 'Status' to the wrong field", () => {
    const section = planSection([
      "No.", "High Level Programme", "Planned Start", "Duration", "Planned End",
      "Actual Start", "Duration", "Actual End", "Status", "Expected Status", "Comment",
    ]);
    // Simulate a bad remembered mapping for this template binding Status → owner.
    const learned = [{ section: "PLAN", sourceHeader: "Status", canonicalField: "owner", confidenceWeight: 1 }];
    const result = mapColumns(section, new ExcelJS.Workbook(), learned);
    const byField = new Map(result.mappings.map((m) => [m.canonicalField, m.rawHeader]));
    expect(byField.get("pct_complete"), "Status reclaimed for actual %").toBe("Status");
    expect(byField.get("expected_pct")).toBe("Expected Status");
    expect(byField.get("owner"), "Status no longer mis-bound to owner").toBeUndefined();
    expect(planActualPctGap(result)).toBe(false);
  });
});

describe("planActualPctGap — silent-zero footgun guard", () => {
  const planMapping = (fields: string[]): MappingResult => ({
    section: "PLAN",
    mappings: fields.map((canonicalField, i) => ({
      colIndex: i, rawHeader: canonicalField, canonicalField, confidence: 1, matchType: "exact" as const,
    })),
    unmappedHeaders: [],
    missingRequired: [],
    overallConfidence: 1,
  });

  it("flags a plan that mapped expected-% but not actual-%", () => {
    expect(planActualPctGap(planMapping(["task_name", "expected_pct"]))).toBe(true);
  });
  it("does not flag when both are mapped", () => {
    expect(planActualPctGap(planMapping(["task_name", "pct_complete", "expected_pct"]))).toBe(false);
  });
  it("does not flag when neither is mapped (legitimately early plan)", () => {
    expect(planActualPctGap(planMapping(["task_name", "start_date"]))).toBe(false);
  });
  it("ignores non-PLAN sections and undefined", () => {
    expect(planActualPctGap({ ...planMapping(["expected_pct"]), section: "REVENUE" })).toBe(false);
    expect(planActualPctGap(undefined)).toBe(false);
  });
});
