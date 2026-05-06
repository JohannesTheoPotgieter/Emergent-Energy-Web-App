/**
 * Task #142 — pure unit coverage for `shared/config/qb-allocations.ts`.
 *
 * The tolerance helpers are loaded by both the server writer
 * (`confirmLinksWithAllocations`) and the client drawer (Approve-button
 * gate), so any regression here ripples into both code paths. These tests
 * pin the contract:
 *
 *   * tolerance = max(R0.50, 0.5% of |qbDocTotal|)
 *   * sum check is `ok` when sum ≤ total + tolerance (under-allocation
 *     is allowed as a partial settlement; only over-allocation rejects)
 *   * `toleranceApplied` is true only for non-zero deltas inside tolerance
 *   * `partial` is true when sum < total - tolerance, with `remaining`
 *     reporting the unallocated Rand on the QB doc
 *   * null QB doc total ⇒ writer skips the sum check (`ok=true`,
 *     `delta=null`) — UI still renders the editor.
 *   * `effectiveAllocatedAmountExVat` falls back to `qb_amount` for legacy
 *     single-link rows so multimap consumers never see 0 for a real link.
 */
import { describe, expect, it } from "vitest";
import {
  QB_ALLOCATION_FIXED_TOLERANCE_ZAR,
  QB_ALLOCATION_PCT_TOLERANCE,
  checkQbAllocationSum,
  effectiveAllocatedAmountExVat,
  qbAllocationToleranceFor,
} from "../../../shared/config/qb-allocations";

describe("qbAllocationToleranceFor", () => {
  it("returns 0 for null/undefined totals", () => {
    expect(qbAllocationToleranceFor(null)).toBe(0);
    expect(qbAllocationToleranceFor(undefined as unknown as number)).toBe(0);
  });

  it("uses the fixed R0.50 floor for small docs", () => {
    // 0.5% of R10 = R0.05 < R0.50 ⇒ floor wins
    expect(qbAllocationToleranceFor(10)).toBe(QB_ALLOCATION_FIXED_TOLERANCE_ZAR);
    expect(qbAllocationToleranceFor(99)).toBe(QB_ALLOCATION_FIXED_TOLERANCE_ZAR);
  });

  it("crosses to the percentage rule once doc > R100", () => {
    // 0.5% of R200 = R1.00 > R0.50 ⇒ pct wins
    expect(qbAllocationToleranceFor(200)).toBe(200 * QB_ALLOCATION_PCT_TOLERANCE);
    expect(qbAllocationToleranceFor(100_000)).toBe(500); // 0.5% of R100k
  });

  it("ignores sign of the doc total (uses absolute value)", () => {
    expect(qbAllocationToleranceFor(-10_000)).toBe(50);
  });
});

describe("checkQbAllocationSum", () => {
  it("balanced sum is ok, not partial, not tolerance-applied", () => {
    const r = checkQbAllocationSum(1000, [
      { allocatedAmountExVat: 600 },
      { allocatedAmountExVat: 400 },
    ]);
    expect(r.sum).toBe(1000);
    expect(r.delta).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.toleranceApplied).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("delta within tolerance flags toleranceApplied (under)", () => {
    // R10k tolerance = R50; supply R5 short.
    const r = checkQbAllocationSum(10_000, [
      { allocatedAmountExVat: 9_995 },
    ]);
    expect(r.delta).toBe(-5);
    expect(r.ok).toBe(true);
    expect(r.toleranceApplied).toBe(true);
    expect(r.partial).toBe(false);
  });

  it("under-allocation beyond tolerance is allowed as partial", () => {
    // R5,813,800 doc, tolerance R29,069; allocate R290,690 only.
    const r = checkQbAllocationSum(5_813_800, [{ allocatedAmountExVat: 290_690 }]);
    expect(r.delta).toBe(-5_523_110);
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.remaining).toBe(5_523_110);
    expect(r.toleranceApplied).toBe(false);
  });

  it("over-allocation beyond tolerance is rejected", () => {
    const r = checkQbAllocationSum(1000, [{ allocatedAmountExVat: 1010 }]);
    // tolerance = max(0.50, 0.5% * 1000) = R5; delta +R10 ⇒ fail
    expect(r.delta).toBe(10);
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.toleranceApplied).toBe(false);
  });

  it("null total skips the check (writer policy)", () => {
    const r = checkQbAllocationSum(null, [
      { allocatedAmountExVat: 100 },
      { allocatedAmountExVat: 200 },
    ]);
    expect(r.sum).toBe(300);
    expect(r.delta).toBeNull();
    expect(r.ok).toBe(true);
  });

  it("rounds to 2dp to absorb FP drift in inputs", () => {
    const r = checkQbAllocationSum(1, [
      { allocatedAmountExVat: 0.1 },
      { allocatedAmountExVat: 0.2 },
      { allocatedAmountExVat: 0.7 },
    ]);
    expect(r.sum).toBe(1);
    expect(r.delta).toBe(0);
    expect(r.ok).toBe(true);
  });
});

describe("effectiveAllocatedAmountExVat", () => {
  it("prefers explicit allocation when > 0", () => {
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: "250.00", qbAmount: "1000" }),
    ).toBe(250);
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: 250, qbAmount: 1000 }),
    ).toBe(250);
  });

  it("falls back to qb_amount when allocation is null/0 (legacy rows)", () => {
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: null, qbAmount: "1000" }),
    ).toBe(1000);
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: 0, qbAmount: 750 }),
    ).toBe(750);
  });

  it("returns null when both fields are unknown", () => {
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: null, qbAmount: null }),
    ).toBeNull();
  });

  it("returns null on malformed strings rather than NaN", () => {
    expect(
      effectiveAllocatedAmountExVat({ allocatedAmountExVat: null, qbAmount: "not-a-number" }),
    ).toBeNull();
  });
});
