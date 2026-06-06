/**
 * R1 COS line-review period-lock matrix.
 *
 * Pins the pure date classification the line-review write endpoints feed into
 * `guardCosPeriodLock`, so the lock can't silently regress (mirrors the QB
 * cascade lock-matrix test). The endpoints themselves are thin wrappers: load
 * the snapshot → guard these dates → write → audit. Proving the matrix proves
 * a move can't slip a line into (or out of) a locked month unguarded.
 */
import { describe, expect, it } from "vitest";
import { cosLineReviewAffectedDates } from "../../../server/lib/finance/cos-line-review-dates";

// Imported invoice date Jan; line already moved to March via an override.
const MOVED = { invoiceDate: "2026-01-20", recognitionDateOverride: "2026-03-15" };
// A plain, un-moved line.
const PLAIN = { invoiceDate: "2026-01-20", recognitionDateOverride: null };

describe("R1 line-review period-lock matrix", () => {
  it("move-period guards BOTH the source month and the target month", () => {
    // From its imported Jan month to a chosen May month.
    expect(cosLineReviewAffectedDates("move_period", PLAIN, "2026-05-01")).toEqual([
      "2026-01-20",
      "2026-05-01",
    ]);
  });

  it("set-invoice-date guards BOTH the current recognition month and the new date", () => {
    // Currently recognised in March (override); set to a specific Feb date.
    expect(cosLineReviewAffectedDates("set_invoice_date", MOVED, "2026-02-10")).toEqual([
      "2026-03-15",
      "2026-02-10",
    ]);
  });

  it("clear-override (undo) guards the override month AND the imported month it returns to", () => {
    expect(cosLineReviewAffectedDates("clear_override", MOVED, null)).toEqual([
      "2026-03-15",
      "2026-01-20",
    ]);
  });

  it("remove guards the line's current recognition month only", () => {
    expect(cosLineReviewAffectedDates("remove", MOVED, null)).toEqual(["2026-03-15"]);
    expect(cosLineReviewAffectedDates("remove", PLAIN, null)).toEqual(["2026-01-20"]);
  });

  it("the source recognition month is the override when present, else the invoice date", () => {
    expect(cosLineReviewAffectedDates("remove", MOVED, null)).toEqual(["2026-03-15"]);
    expect(cosLineReviewAffectedDates("remove", PLAIN, null)).toEqual(["2026-01-20"]);
  });

  it("de-duplicates when source and target resolve to the same date (no-op move)", () => {
    // Moving a plain Jan line 'to' its own imported date guards just one period.
    expect(cosLineReviewAffectedDates("set_invoice_date", PLAIN, "2026-01-20")).toEqual([
      "2026-01-20",
    ]);
  });

  it("never emits a null/empty date (a guard must always resolve a period)", () => {
    const noDates = { invoiceDate: null, recognitionDateOverride: null };
    expect(cosLineReviewAffectedDates("move_period", noDates, "2026-07-01")).toEqual([
      "2026-07-01",
    ]);
    expect(cosLineReviewAffectedDates("remove", noDates, null)).toEqual([]);
  });
});
