/**
 * QuickBooks Reconciliation worklist logic (feat/qb-recon-view).
 *
 * Pure tests for the view's worklist builder: it buckets lines into the right
 * period, hides clean matches, orders amount-variance first (then tracker-only,
 * qb-only, timing), supports sort-by-value, and surfaces a matched-but-
 * cross-period line as `timing`.
 */
import { describe, expect, it } from "vitest";

import {
  buildWorklist,
  displayStatus,
  periodKeyFor,
  isoWeekKey,
  type ReconLineLike,
} from "../../../client/src/lib/finance/qb-recon-worklist";

const line = (over: Partial<ReconLineLike>): ReconLineLike => ({
  trackerAmountExVat: null,
  qbAmountExVat: null,
  delta: null,
  status: "matched",
  trackerDate: null,
  qbDate: null,
  timingFlag: false,
  ...over,
});

const LINES: ReconLineLike[] = [
  line({ status: "matched", trackerAmountExVat: "1000", qbAmountExVat: "1000", trackerDate: "2026-06-10" }), // clean → hidden
  line({ status: "amount_variance", trackerAmountExVat: "5000", qbAmountExVat: "4000", delta: "1000", trackerDate: "2026-06-12" }),
  line({ status: "tracker_only", trackerAmountExVat: "800", trackerDate: "2026-06-15" }),
  line({ status: "qb_only", qbAmountExVat: "600", qbDate: "2026-06-18" }),
  line({ status: "matched", trackerAmountExVat: "7000", qbAmountExVat: "7000", trackerDate: "2026-06-28", qbDate: "2026-07-05", timingFlag: true }), // timing
  line({ status: "amount_variance", trackerAmountExVat: "200", qbAmountExVat: "100", delta: "100", trackerDate: "2026-07-02" }), // July → other period
];

describe("displayStatus", () => {
  it("maps matched+timingFlag → timing, clean matched → matched", () => {
    expect(displayStatus(line({ status: "matched", timingFlag: true }))).toBe("timing");
    expect(displayStatus(line({ status: "matched", timingFlag: false }))).toBe("matched");
    expect(displayStatus(line({ status: "amount_variance" }))).toBe("amount_variance");
  });
});

describe("buildWorklist — month grain, status-grouped", () => {
  const wl = buildWorklist(LINES, "2026-06", "month", false);

  it("excludes clean matches and other-period lines", () => {
    expect(wl).toHaveLength(4); // variance, tracker_only, qb_only, timing (June only)
    expect(wl.every((l) => displayStatus(l) !== "matched")).toBe(true);
  });

  it("orders amount-variance FIRST (the seeded variance is top of the worklist)", () => {
    expect(displayStatus(wl[0])).toBe("amount_variance");
    expect(Number(wl[0].trackerAmountExVat)).toBe(5000);
  });

  it("orders variance → tracker_only → qb_only → timing", () => {
    expect(wl.map(displayStatus)).toEqual(["amount_variance", "tracker_only", "qb_only", "timing"]);
  });
});

describe("buildWorklist — sort by value", () => {
  it("orders purely by descending value when sortByValue is set", () => {
    const wl = buildWorklist(LINES, "2026-06", "month", true);
    expect(wl.map((l) => Math.abs(Number(l.trackerAmountExVat ?? l.qbAmountExVat)))).toEqual([7000, 5000, 800, 600]);
  });
});

describe("period bucketing", () => {
  it("day / month / week keys mirror the server", () => {
    expect(periodKeyFor("2026-06-28", "day")).toBe("2026-06-28");
    expect(periodKeyFor("2026-06-28", "month")).toBe("2026-06");
    expect(isoWeekKey("2026-06-28")).toBe("2026-W26");
  });

  it("filters the worklist to the selected period", () => {
    const july = buildWorklist(LINES, "2026-07", "month", false);
    expect(july).toHaveLength(1); // only the July variance
    expect(displayStatus(july[0])).toBe("amount_variance");
    expect(Number(july[0].trackerAmountExVat)).toBe(200);
  });
});
