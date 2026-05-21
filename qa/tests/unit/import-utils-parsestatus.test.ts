/**
 * Locks in the contract for `parseStatus` (Smart Import v2 percent-complete
 * extractor). The same helper feeds both `pctComplete` and
 * `expectedPctComplete` on plan tasks — getting either of these wrong leads
 * to wrong "behind plan" / "ahead of schedule" classifications on every
 * dashboard that reads work_items.
 *
 * The result is the canonical 0..1 scale that work_items.percent_complete
 * stores. Sources that come through the importer in practice:
 *
 *   - Numeric Excel cells the workbook author typed as "50%" → ExcelJS
 *     returns 0.5 (Excel's native percent format stores 0..1).
 *   - Numeric Excel cells typed as plain integers "75" → returned as 75.
 *   - Formula cells like `=R/Q` returning either 0..1 or 0..100.
 *   - Older trackers that used text status words ("Complete" / "Not
 *     Started") instead of a numeric %.
 *   - Boolean cells the workbook used as a done / not-done marker.
 *   - Empty cells.
 *
 * parseStatus must handle all of these uniformly to 0..1. The clampPercent
 * downstream defends against bogus inputs from other code paths; this test
 * pins the *extractor* contract so the canonical scale is locked at the
 * boundary, not relied on to be fixed later.
 */

import { describe, expect, it } from "vitest";
import { parseStatus } from "../../../server/lib/import/utils";

describe("parseStatus — empty / invalid inputs", () => {
  it.each([null, undefined, "", "   "])("%j → null", (input) => {
    expect(parseStatus(input)).toBeNull();
  });

  it.each(["not a percent", "abc"])("%j → null", (input) => {
    expect(parseStatus(input)).toBeNull();
  });

  it("Excel #REF! string → null", () => {
    expect(parseStatus("#REF!")).toBeNull();
  });

  it("Excel structured error → null", () => {
    expect(parseStatus({ error: "#DIV/0!" })).toBeNull();
  });

  it("non-finite number → null", () => {
    expect(parseStatus(Number.NaN)).toBeNull();
    expect(parseStatus(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("parseStatus — numeric values (Excel native percent + raw integer)", () => {
  it("0 → 0", () => expect(parseStatus(0)).toBe(0));
  it("0.5 (ExcelJS native percent) → 0.5", () => expect(parseStatus(0.5)).toBe(0.5));
  it("1 (100%) → 1", () => expect(parseStatus(1)).toBe(1));

  it("50 (typed as integer) → 0.5", () => expect(parseStatus(50)).toBe(0.5));
  it("100 → 1", () => expect(parseStatus(100)).toBe(1));
  it("75 → 0.75", () => expect(parseStatus(75)).toBe(0.75));

  it("negative → clamped to 0", () => {
    expect(parseStatus(-0.2)).toBe(0);
    expect(parseStatus(-50)).toBe(0);
  });

  it(">100 → clamped to 1 (defensive)", () => {
    expect(parseStatus(150)).toBe(1);
    expect(parseStatus(500)).toBe(1);
  });
});

describe("parseStatus — string formats", () => {
  it("'50%' → 0.5", () => expect(parseStatus("50%")).toBe(0.5));
  it("'100%' → 1", () => expect(parseStatus("100%")).toBe(1));
  it("'0%' → 0", () => expect(parseStatus("0%")).toBe(0));
  it("'75' (no percent sign) → 0.75", () => expect(parseStatus("75")).toBe(0.75));
  it("'0.5' (already on 0..1) → 0.5", () => expect(parseStatus("0.5")).toBe(0.5));
  it("'  50%  ' (whitespace) → 0.5", () => expect(parseStatus("  50%  ")).toBe(0.5));
});

describe("parseStatus — boolean cells (TRUE/FALSE as done marker)", () => {
  it("true → 1", () => expect(parseStatus(true)).toBe(1));
  it("false → 0", () => expect(parseStatus(false)).toBe(0));
});

describe("parseStatus — text status keywords (legacy trackers)", () => {
  it("'Complete' → 1", () => expect(parseStatus("Complete")).toBe(1));
  it("'complete' → 1", () => expect(parseStatus("complete")).toBe(1));
  it("'Completed' → 1", () => expect(parseStatus("Completed")).toBe(1));
  it("'Done' → 1", () => expect(parseStatus("Done")).toBe(1));

  it("'Not Started' → 0", () => expect(parseStatus("Not Started")).toBe(0));
  it("'not-started' → 0", () => expect(parseStatus("not-started")).toBe(0));

  it("'In Progress' (no numeric component) → null", () => {
    // Importer can't tell the actual progress percentage from the word
    // alone; leaving it null gives downstream `expectedPctFromDates` a
    // chance to compute a real value from the date range instead of
    // pretending the row is 0% complete.
    expect(parseStatus("In Progress")).toBeNull();
  });
});

describe("parseStatus — Excel formula cells", () => {
  it("formula cell with numeric result is unwrapped", () => {
    expect(parseStatus({ formula: "=R6/Q6", result: 0.85 })).toBe(0.85);
  });

  it("formula cell with %-scale numeric result is unwrapped + scaled", () => {
    expect(parseStatus({ formula: "=R6/Q6*100", result: 75 })).toBe(0.75);
  });

  it("formula cell with empty result → null", () => {
    expect(parseStatus({ formula: "=IF(A1,B1,\"\")", result: "" })).toBeNull();
  });

  it("formula cell with #DIV/0! result → null", () => {
    expect(parseStatus({ formula: "=A1/B1", result: "#DIV/0!" })).toBeNull();
  });

  it("shared formula with cached numeric result", () => {
    expect(parseStatus({ sharedFormula: "R7", result: 0.5 })).toBe(0.5);
  });
});
