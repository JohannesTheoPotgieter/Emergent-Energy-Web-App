/**
 * COS line-review integrity flags (R2 / R3 / R4).
 *
 * Pure-function tests for `computeCosLineFlags` — each flag must FIRE on the
 * offending shape and stay quiet on the clean shape, with no cross-talk.
 */
import { describe, it, expect } from "vitest";
import {
  computeCosLineFlags,
  ANOMALY_MEDIAN_FACTOR,
  type CosLineFlagInput,
} from "../../../server/lib/finance/cos-line-flags";

const line = (over: Partial<CosLineFlagInput> & { lineId: number }): CosLineFlagInput => ({
  projectId: 1,
  categoryAllocationId: 1,
  actualTotal: 100,
  poNumber: null,
  derivationWarning: null,
  ...over,
});

describe("computeCosLineFlags — R2 allocation missing", () => {
  it("FIRES when the § 3.3 derivation reports a missing revenue allocation", () => {
    const [flags] = computeCosLineFlags(
      [line({ lineId: 1, derivationWarning: "category_revenue_allocation_missing" })],
      new Map(),
    );
    expect(flags.allocationMissing).toBe(true);
    expect(flags.flagged).toBe(true);
  });

  it("FIRES on the linkage-missing variant too", () => {
    const [flags] = computeCosLineFlags(
      [line({ lineId: 1, derivationWarning: "missing_category_allocation_linkage" })],
      new Map(),
    );
    expect(flags.allocationMissing).toBe(true);
  });

  it("stays quiet for a healthy line and for unrelated warnings", () => {
    const [ok, other] = computeCosLineFlags(
      [
        line({ lineId: 1, derivationWarning: null }),
        line({ lineId: 2, derivationWarning: "category_total_actual_zero" }),
      ],
      new Map(),
    );
    expect(ok.allocationMissing).toBe(false);
    expect(other.allocationMissing).toBe(false);
  });
});

describe("computeCosLineFlags — R3 invoice↔PO mismatch", () => {
  it("FIRES when invoiced cost on a PO EXCEEDS the PO total (all its lines flag)", () => {
    const flags = computeCosLineFlags(
      [
        line({ lineId: 1, poNumber: "100", actualTotal: 700 }),
        line({ lineId: 2, poNumber: "100", actualTotal: 600 }),
      ],
      new Map([["100", 1000]]), // PO authorises 1000, invoiced 1300
    );
    expect(flags.every((f) => f.poMismatch)).toBe(true);
    expect(flags[0].poDelta).toBe(300);
  });

  it("does NOT fire for partial/under-invoicing (a PO not yet fully delivered)", () => {
    const [flags] = computeCosLineFlags(
      [line({ lineId: 1, poNumber: "100", actualTotal: 300 })],
      new Map([["100", 1000]]),
    );
    expect(flags.poMismatch).toBe(false);
    expect(flags.poDelta).toBe(-700);
  });

  it("does NOT fire when invoiced equals the PO within tolerance", () => {
    const flags = computeCosLineFlags(
      [line({ lineId: 1, poNumber: "100", actualTotal: 1000.5 })],
      new Map([["100", 1000]]),
    );
    expect(flags[0].poMismatch).toBe(false);
  });

  it("never fires for a PO with no comparable authorised total (external / legacy)", () => {
    const [flags] = computeCosLineFlags(
      [line({ lineId: 1, poNumber: "999", actualTotal: 50000 })],
      new Map(), // 999 not present
    );
    expect(flags.poMismatch).toBe(false);
    expect(flags.poDelta).toBeNull();
  });
});

describe("computeCosLineFlags — R4 >=8x category-median anomaly", () => {
  it(`FIRES on a line >= ${ANOMALY_MEDIAN_FACTOR}x its category median, not its peers`, () => {
    const flags = computeCosLineFlags(
      [
        line({ lineId: 1, actualTotal: 100 }),
        line({ lineId: 2, actualTotal: 100 }),
        line({ lineId: 3, actualTotal: 100 }),
        line({ lineId: 4, actualTotal: 1000 }), // 10x median(100)
      ],
      new Map(),
    );
    const byId = new Map(flags.map((f) => [f.lineId, f]));
    expect(byId.get(4)!.anomaly).toBe(true);
    expect(byId.get(4)!.anomalyFactor).toBe(10);
    expect(byId.get(1)!.anomaly).toBe(false);
  });

  it("medians are per-category — a big line in its own category is not anomalous", () => {
    const flags = computeCosLineFlags(
      [
        line({ lineId: 1, categoryAllocationId: 1, actualTotal: 100 }),
        line({ lineId: 2, categoryAllocationId: 1, actualTotal: 100 }),
        line({ lineId: 3, categoryAllocationId: 2, actualTotal: 5000 }),
      ],
      new Map(),
    );
    expect(flags.find((f) => f.lineId === 3)!.anomaly).toBe(false);
  });

  it("does not divide by zero when a category median is 0", () => {
    const flags = computeCosLineFlags(
      [
        line({ lineId: 1, actualTotal: 0 }),
        line({ lineId: 2, actualTotal: 0 }),
      ],
      new Map(),
    );
    expect(flags.every((f) => f.anomaly === false && f.anomalyFactor === null)).toBe(true);
  });
});

describe("computeCosLineFlags — independence", () => {
  it("a fully clean portfolio produces no flags at all", () => {
    const flags = computeCosLineFlags(
      [
        line({ lineId: 1, actualTotal: 100, poNumber: "100" }),
        line({ lineId: 2, actualTotal: 120, poNumber: "100" }),
      ],
      new Map([["100", 1000]]), // 220 invoiced << 1000 authorised — fine
    );
    expect(flags.some((f) => f.flagged)).toBe(false);
  });
});
