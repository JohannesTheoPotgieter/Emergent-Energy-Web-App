/**
 * Smart Import — noRevenueLinked recon trigger tests (field-coverage gap #4).
 *
 * Verifies the S11 recon logic: cost lines inserted in a run that have no
 * category allocation FK (and no revenueRecognitionAmount) must be flagged
 * noRevenueLinked = true after commit. Lines with a match are left alone.
 *
 * The recon is inlined in smart-import-routes.ts (after S10) and fires only
 * when catAllocIdByKey is non-empty (workbook provided budget pane data).
 */

import { describe, expect, it } from "vitest";

// Represents a cost line row as seen after S10 / before S11.
type CostLineRow = {
  id: number;
  importRunId: number;
  categoryAllocationId: number | null;
  revenueRecognitionAmount: string | null;
  noRevenueLinked: boolean;
};

/**
 * Mirrors the S11 recon filter: returns the ids that WOULD be updated to
 * noRevenueLinked = true by the recon query.
 *
 * @param rows         Active NCL rows for the project after S10 ran.
 * @param runId        The current import run id.
 * @param hasCatAllocs Whether the workbook provided category allocations.
 */
function reconNoRevenueLinked(
  rows: CostLineRow[],
  runId: number,
  hasCatAllocs: boolean,
): number[] {
  if (!hasCatAllocs) return [];
  return rows
    .filter(
      r =>
        r.importRunId === runId &&
        r.categoryAllocationId == null &&
        r.revenueRecognitionAmount == null,
    )
    .map(r => r.id);
}

describe("S11 noRevenueLinked recon", () => {
  const RUN = 42;

  it("flags newly inserted lines with no category allocation (fresh import)", () => {
    const rows: CostLineRow[] = [
      { id: 1, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
      { id: 2, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
    ];
    const flagged = reconNoRevenueLinked(rows, RUN, true);
    expect(flagged).toEqual([1, 2]);
  });

  it("does NOT flag lines that have a categoryAllocationId", () => {
    const rows: CostLineRow[] = [
      { id: 1, importRunId: RUN, categoryAllocationId: 101, revenueRecognitionAmount: null, noRevenueLinked: false },
    ];
    expect(reconNoRevenueLinked(rows, RUN, true)).toEqual([]);
  });

  it("does NOT flag lines that have a revenueRecognitionAmount", () => {
    const rows: CostLineRow[] = [
      { id: 1, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: "50000.00", noRevenueLinked: false },
    ];
    expect(reconNoRevenueLinked(rows, RUN, true)).toEqual([]);
  });

  it("does NOT touch rows from a prior run (manual flags preserved)", () => {
    const rows: CostLineRow[] = [
      // Older row with no allocation — should NOT be touched
      { id: 1, importRunId: 10, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: true },
      // Current run row with no allocation — SHOULD be flagged
      { id: 2, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
    ];
    expect(reconNoRevenueLinked(rows, RUN, true)).toEqual([2]);
  });

  it("does nothing when the workbook had no category allocations (hasCatAllocs=false)", () => {
    const rows: CostLineRow[] = [
      { id: 1, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
    ];
    // No budget pane → skip the recon entirely to avoid mass-flagging all lines.
    expect(reconNoRevenueLinked(rows, RUN, false)).toEqual([]);
  });

  it("mixed batch: only flags the unlinked new lines", () => {
    const rows: CostLineRow[] = [
      // Current run, no link → flag
      { id: 1, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
      // Current run, has allocation → leave
      { id: 2, importRunId: RUN, categoryAllocationId: 101, revenueRecognitionAmount: null, noRevenueLinked: false },
      // Current run, has rev recognition amount → leave
      { id: 3, importRunId: RUN, categoryAllocationId: null, revenueRecognitionAmount: "10000", noRevenueLinked: false },
      // Old run, no link → leave (manual flag preserved)
      { id: 4, importRunId: 5, categoryAllocationId: null, revenueRecognitionAmount: null, noRevenueLinked: false },
    ];
    expect(reconNoRevenueLinked(rows, RUN, true)).toEqual([1]);
  });
});
