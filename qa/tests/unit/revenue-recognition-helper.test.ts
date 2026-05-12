/**
 * Unit tests for the § 3.3 canonical revenue-recognition helper
 * (`server/lib/finance/revenue-recognition.ts`).
 *
 * This is the single source of truth for "Revenue" in every read-side
 * endpoint after the § 3.3 hotfix. The helper reads the persisted
 * `revenue_recognition_amount` column written at Smart Import time by
 * the category-scoped per-line POC formula — it does NOT re-derive.
 *
 * Fixture-based numeric tests pin the contract:
 *   - rowType != "item"   → 0
 *   - noRevenueLinked     → 0
 *   - amount missing/null → 0
 *   - amount as string    → parseFloat
 *   - amount as number    → returned as-is
 *
 * The aggregation helpers (`sumRevenueRecognition`,
 * `sumRevenueRecognitionByProject`) are covered with a 3-line project
 * fixture that mirrors the audit example (1 of 3 lines NRL, varying
 * amounts) to ensure NRL rows contribute exactly 0.
 */

import { describe, expect, it } from "vitest";
import {
  recognitionAmountFor,
  sumRevenueRecognition,
  sumRevenueRecognitionByProject,
  getRevenueRecognitionForProject,
  type CostLineForRecognition,
} from "../../../server/lib/finance/revenue-recognition";

function makeLine(overrides: Partial<CostLineForRecognition> = {}): CostLineForRecognition {
  return {
    rowType: "item",
    projectName: "TestProject",
    revenueRecognitionAmount: null,
    noRevenueLinked: false,
    ...overrides,
  };
}

describe("recognitionAmountFor", () => {
  it("returns the persisted amount for a normal item line", () => {
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: "12345.67" }))).toBeCloseTo(12345.67, 2);
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: 99 }))).toBe(99);
  });

  it("returns 0 when rowType is not 'item' (header / category / summary rows)", () => {
    expect(recognitionAmountFor(makeLine({ rowType: "category", revenueRecognitionAmount: "1000" }))).toBe(0);
    expect(recognitionAmountFor(makeLine({ rowType: "header", revenueRecognitionAmount: "1000" }))).toBe(0);
    expect(recognitionAmountFor(makeLine({ rowType: null, revenueRecognitionAmount: "1000" }))).toBe(0);
  });

  it("returns 0 when noRevenueLinked is true (PM has flagged the line as not linked to revenue)", () => {
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: "5000", noRevenueLinked: true }))).toBe(0);
  });

  it("returns 0 for missing / null / empty / unparseable amounts", () => {
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: null }))).toBe(0);
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: "" }))).toBe(0);
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: "not-a-number" }))).toBe(0);
    expect(recognitionAmountFor(makeLine({}))).toBe(0);
  });

  it("returns 0 for non-finite numeric values (NaN, Infinity)", () => {
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: Number.NaN }))).toBe(0);
    expect(recognitionAmountFor(makeLine({ revenueRecognitionAmount: Number.POSITIVE_INFINITY }))).toBe(0);
  });

  it("does NOT derive from project totals on the fly (regression: § 3.3)", () => {
    // The pre-hotfix formula was `(amount / totalCOS) * totalMilestoneRevenue`.
    // The helper must not look at any other line's data — only the
    // persisted column on the line itself.
    const line = makeLine({ revenueRecognitionAmount: "1000" });
    // Even if we attach bogus project-total fields, they must be ignored.
    (line as any).totalCOSProject = 99999;
    (line as any).totalMilestoneRevenue = 99999;
    expect(recognitionAmountFor(line)).toBe(1000);
  });
});

describe("sumRevenueRecognition", () => {
  it("sums non-NRL item lines and excludes NRL / non-item rows", () => {
    const lines: CostLineForRecognition[] = [
      makeLine({ revenueRecognitionAmount: "1000" }),                                       // 1000
      makeLine({ revenueRecognitionAmount: "2000", noRevenueLinked: true }),                // 0 (NRL)
      makeLine({ revenueRecognitionAmount: "500" }),                                        // 500
      makeLine({ revenueRecognitionAmount: "300", rowType: "category" }),                   // 0 (not item)
      makeLine({ revenueRecognitionAmount: null }),                                          // 0 (missing)
    ];
    // Reproduces the audit example: only the 2 valid item lines contribute.
    expect(sumRevenueRecognition(lines)).toBe(1500);
  });

  it("returns 0 for an empty list", () => {
    expect(sumRevenueRecognition([])).toBe(0);
  });
});

describe("sumRevenueRecognitionByProject", () => {
  it("buckets by project name, stripping _Tracker suffix", () => {
    const lines: CostLineForRecognition[] = [
      makeLine({ projectName: "AlphaSolar", revenueRecognitionAmount: "1000" }),
      makeLine({ projectName: "AlphaSolar_Tracker", revenueRecognitionAmount: "500" }),  // stripped to AlphaSolar
      makeLine({ projectName: "Beta", revenueRecognitionAmount: "2000" }),
      makeLine({ projectName: "Beta", revenueRecognitionAmount: "100", noRevenueLinked: true }), // NRL → 0
    ];
    const m = sumRevenueRecognitionByProject(lines);
    expect(m.get("AlphaSolar")).toBe(1500);
    expect(m.get("Beta")).toBe(2000);
  });

  it("omits projects whose lines sum to zero", () => {
    const lines: CostLineForRecognition[] = [
      makeLine({ projectName: "Gamma", revenueRecognitionAmount: "100", noRevenueLinked: true }),
      makeLine({ projectName: "Delta", revenueRecognitionAmount: null }),
    ];
    const m = sumRevenueRecognitionByProject(lines);
    expect(m.has("Gamma")).toBe(false);
    expect(m.has("Delta")).toBe(false);
  });
});

describe("getRevenueRecognitionForProject", () => {
  it("returns the project total, handling _Tracker suffix on either side", () => {
    const lines: CostLineForRecognition[] = [
      makeLine({ projectName: "Acme", revenueRecognitionAmount: "750" }),
      makeLine({ projectName: "Acme_Tracker", revenueRecognitionAmount: "250" }),
      makeLine({ projectName: "Other", revenueRecognitionAmount: "9999" }),
    ];
    expect(getRevenueRecognitionForProject(lines, "Acme")).toBe(1000);
    expect(getRevenueRecognitionForProject(lines, "Acme_Tracker")).toBe(1000);
    expect(getRevenueRecognitionForProject(lines, "Unknown")).toBe(0);
  });
});
