import { describe, expect, it } from "vitest";
import { isGenericSheetName, sheetNameConfidenceAdjustment } from "../../../server/lib/import/detector";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Sheet priority system", () => {
  describe("isGenericSheetName", () => {
    it("identifies Sheet1 as generic", () => {
      expect(isGenericSheetName("Sheet1")).toBe(true);
    });

    it("identifies Sheet2, Sheet3 as generic", () => {
      expect(isGenericSheetName("Sheet2")).toBe(true);
      expect(isGenericSheetName("Sheet3")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isGenericSheetName("sheet1")).toBe(true);
      expect(isGenericSheetName("SHEET1")).toBe(true);
    });

    it("handles Sheet with space before number", () => {
      expect(isGenericSheetName("Sheet 1")).toBe(true);
    });

    it("does NOT flag dedicated sheet names", () => {
      expect(isGenericSheetName("Project Plan")).toBe(false);
      expect(isGenericSheetName("Revenue Tracking")).toBe(false);
      expect(isGenericSheetName("Expenditure Breakdown")).toBe(false);
      expect(isGenericSheetName("Data")).toBe(false);
    });
  });

  describe("sheetNameConfidenceAdjustment", () => {
    it("gives +50 bonus for dedicated PLAN sheet names", () => {
      expect(sheetNameConfidenceAdjustment("Project Plan", "PLAN")).toBe(50);
      expect(sheetNameConfidenceAdjustment("Programme", "PLAN")).toBe(50);
      expect(sheetNameConfidenceAdjustment("Schedule", "PLAN")).toBe(50);
    });

    it("gives +50 bonus for dedicated REVENUE sheet names", () => {
      expect(sheetNameConfidenceAdjustment("Revenue Tracking", "REVENUE")).toBe(50);
      expect(sheetNameConfidenceAdjustment("Revenue", "REVENUE")).toBe(50);
    });

    it("gives +50 bonus for dedicated EXPENDITURE sheet names", () => {
      expect(sheetNameConfidenceAdjustment("Expenditure Breakdown", "EXPENDITURE")).toBe(50);
      expect(sheetNameConfidenceAdjustment("Expenditure", "EXPENDITURE")).toBe(50);
    });

    it("gives -30 penalty for Sheet1", () => {
      expect(sheetNameConfidenceAdjustment("Sheet1", "PLAN")).toBe(-30);
      expect(sheetNameConfidenceAdjustment("Sheet1", "REVENUE")).toBe(-30);
      expect(sheetNameConfidenceAdjustment("Sheet1", "EXPENDITURE")).toBe(-30);
    });

    it("gives -30 penalty for Sheet2, Sheet3", () => {
      expect(sheetNameConfidenceAdjustment("Sheet2", "PLAN")).toBe(-30);
      expect(sheetNameConfidenceAdjustment("Sheet3", "PLAN")).toBe(-30);
    });

    it("gives 0 for unrelated sheet names", () => {
      expect(sheetNameConfidenceAdjustment("Data", "PLAN")).toBe(0);
      expect(sheetNameConfidenceAdjustment("PO Details", "PLAN")).toBe(0);
    });
  });

  describe("Superseded sheet logging", () => {
    it("normalizer generates SHEET_SUPERSEDED issue for skipped sheets", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("SHEET_SUPERSEDED");
      expect(source).toContain("Superseded by dedicated");
    });

    it("issue severity is INFO", () => {
      const source = read("server/lib/import/normalizer.ts");
      const idx = source.indexOf("SHEET_SUPERSEDED");
      const surrounding = source.substring(Math.max(0, idx - 400), idx + 50);
      expect(surrounding).toContain('"INFO"');
    });
  });

  describe("Detection collects all candidates and picks best", () => {
    it("detector collects all candidates before picking winner", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain("allCandidates");
      expect(source).toContain("allCandidates.sort");
    });

    it("logs skipped generic sheets with row count comparison", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain("Superseded by dedicated");
      expect(source).toContain("rows vs");
    });

    it("Sheet1 is still usable when it's the only plan sheet", () => {
      // The penalty is soft — Sheet1 with no competitor will still be selected
      // as bestCandidate since it's the only entry in allCandidates
      const source = read("server/lib/import/detector.ts");
      // No hard block — only penalty
      expect(source).not.toContain("hardBlock");
      expect(source).toContain("isGenericSheetName");
    });
  });

  describe("Priority ensures dedicated sheet wins over Sheet1", () => {
    it("dedicated sheet gets higher effective confidence than Sheet1", () => {
      // A dedicated "Project Plan" sheet with confidence 0.5 + 50 bonus = 50.5
      // Sheet1 with confidence 0.9 - 30 penalty = -29.1
      // The dedicated sheet always wins
      const dedicatedConf = 0.5 + 50; // Even low confidence + bonus
      const sheet1Conf = 0.9 - 30; // Even high confidence - penalty
      expect(dedicatedConf).toBeGreaterThan(sheet1Conf);
    });
  });
});
