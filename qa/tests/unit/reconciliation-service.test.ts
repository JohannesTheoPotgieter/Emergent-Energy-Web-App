/**
 * Reconciliation service (P2.2) — app-vs-tracker status classification.
 *
 * Acceptance (step 4): seed a drifted revenue_stored on one line → the project
 * turns AMBER and the offending line is identified (so the drawer can name it).
 * Plus the green (ties) and red (structural) classifications.
 *
 * Pure unit tests of the core maths — no database — so the classification is
 * verified deterministically.
 */

import { describe, expect, it } from "vitest";

import {
  computeAppVsTrackerStatus,
  worstStatus,
  RECON_R1,
  type ReconLineInput,
} from "../../../server/services/reconciliation-service";

// reconDelta = revenueStored − perLineRevenue (P2.1 convention).
const line = (
  lineId: number,
  perLineRevenue: number,
  revenueStored: number | null,
  derivationWarning: string | null = null,
): ReconLineInput => ({
  lineId,
  perLineRevenue,
  revenueStored,
  reconDelta: revenueStored == null ? null : revenueStored - perLineRevenue,
  derivationWarning,
});

describe("computeAppVsTrackerStatus", () => {
  it("GREEN — app ties to the tracker within R1 (and no-col-U lines are ignored)", () => {
    const r = computeAppVsTrackerStatus([
      line(31, 500_000, 500_000), // exact tie
      line(32, 300_000, null), // no pasted col U → nothing to reconcile
      line(33, 200_000, 200_000.4), // within R1
    ]);
    expect(r.status).toBe("green");
    expect(r.offendingLineIds).toHaveLength(0);
    expect(r.accumulatedAbsDelta).toBeLessThanOrEqual(RECON_R1);
  });

  it("AMBER — a seeded drifted revenue_stored on ONE line flips the project to drift", () => {
    const r = computeAppVsTrackerStatus([
      line(11, 600_000, 600_000), // ties
      line(12, 400_000, 405_000), // seeded drift: pasted 405k vs formula 400k → +5k
    ]);
    expect(r.status).toBe("amber");
    // The offending line is named so the drawer can drill to it.
    expect(r.offendingLineIds).toEqual([12]);
    expect(r.driftLineIds).toEqual([12]);
    expect(r.offendingLineIds).not.toContain(11);
    expect(r.accumulatedAbsDelta).toBeCloseTo(5_000, 2);
    // app − tracker over comparable lines = −Σ reconDelta = −5000.
    expect(r.appVsTrackerDelta).toBeCloseTo(-5_000, 2);
  });

  it("RED — a structural derivation warning (missing allocation) outranks drift", () => {
    const r = computeAppVsTrackerStatus([
      line(21, 0, null, "category_revenue_allocation_missing"), // structural
      line(22, 100_000, 130_000), // also drifted, but structural wins
    ]);
    expect(r.status).toBe("red");
    expect(r.offendingLineIds).toContain(21);
  });

  it("RED — orphan actuals row with no parent is structural", () => {
    const r = computeAppVsTrackerStatus([
      line(41, 0, null, "orphan_actuals_row_no_parent"),
    ]);
    expect(r.status).toBe("red");
    expect(r.offendingLineIds).toEqual([41]);
  });

  it("empty period → green, nothing to reconcile", () => {
    const r = computeAppVsTrackerStatus([]);
    expect(r.status).toBe("green");
    expect(r.offendingLineIds).toHaveLength(0);
  });
});

describe("worstStatus rollup", () => {
  it("no rows → unknown", () => {
    expect(worstStatus([])).toBe("unknown");
  });
  it("red dominates", () => {
    expect(worstStatus(["green", "amber", "red"])).toBe("red");
  });
  it("amber over green", () => {
    expect(worstStatus(["green", "amber", "green"])).toBe("amber");
  });
  it("all green → green", () => {
    expect(worstStatus(["green", "green"])).toBe("green");
  });
});
