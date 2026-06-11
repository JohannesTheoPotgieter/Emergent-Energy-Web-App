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
  buildSideWorklist,
  displayStatus,
  matchState,
  isCollision,
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

describe("matchState — four worklist states (display mapping, no number change)", () => {
  it("clean match → matched (timing is a matched sub-flag, not a state)", () => {
    expect(matchState(line({ status: "matched" }))).toBe("matched");
    expect(matchState(line({ status: "matched", timingFlag: true }))).toBe("matched");
  });
  it("amount_variance → ambiguous (number matched, amount disagrees)", () => {
    expect(matchState(line({ status: "amount_variance" }))).toBe("ambiguous");
  });
  it("a normalised-number collision → ambiguous even when the status is matched", () => {
    expect(isCollision(line({ invoiceNoRaw: "INV-1|INV-2" }))).toBe(true);
    expect(matchState(line({ status: "matched", invoiceNoRaw: "INV-1|INV-2" }))).toBe("ambiguous");
  });
  it("tracker_only → unmatched_in_qb, qb_only → unmatched_in_tracker", () => {
    expect(matchState(line({ status: "tracker_only" }))).toBe("unmatched_in_qb");
    expect(matchState(line({ status: "qb_only" }))).toBe("unmatched_in_tracker");
  });
});

describe("buildSideWorklist — split by stream, grouped into the four states", () => {
  const SIDE: ReconLineLike[] = [
    line({ stream: "REV", status: "matched", trackerAmountExVat: "1000", qbAmountExVat: "1000", trackerDate: "2026-06-10", invoiceNoRaw: "INV-1" }),
    line({ stream: "REV", status: "amount_variance", trackerAmountExVat: "5000", qbAmountExVat: "4000", trackerDate: "2026-06-12", invoiceNoRaw: "INV-2" }),
    line({ stream: "REV", status: "tracker_only", trackerAmountExVat: "800", trackerDate: "2026-06-15", invoiceNoRaw: "INV-3" }),
    line({ stream: "REV", status: "qb_only", qbAmountExVat: "600", qbDate: "2026-06-18", invoiceNoRaw: "INV-4" }),
    line({ stream: "COS", status: "tracker_only", trackerAmountExVat: "999", trackerDate: "2026-06-20", invoiceNoRaw: "BILL-9" }), // other stream
    line({ stream: "REV", status: "amount_variance", trackerAmountExVat: "200", trackerDate: "2026-07-02", invoiceNoRaw: "INV-5" }), // other period
  ];

  it("keeps only the requested stream + period and buckets the four states", () => {
    const rev = buildSideWorklist(SIDE, "2026-06", "month", "REV");
    expect(rev.stream).toBe("REV");
    expect(rev.matched.map((l) => l.invoiceNoRaw)).toEqual(["INV-1"]);
    expect(rev.ambiguous.map((l) => l.invoiceNoRaw)).toEqual(["INV-2"]);
    expect(rev.unmatchedInQb.map((l) => l.invoiceNoRaw)).toEqual(["INV-3"]);
    expect(rev.unmatchedInTracker.map((l) => l.invoiceNoRaw)).toEqual(["INV-4"]);
    // open = everything except clean matches
    expect(rev.openCount).toBe(3);
  });

  it("excludes the other stream and other periods", () => {
    const cos = buildSideWorklist(SIDE, "2026-06", "month", "COS");
    expect(cos.unmatchedInQb.map((l) => l.invoiceNoRaw)).toEqual(["BILL-9"]);
    expect(cos.openCount).toBe(1);
    const july = buildSideWorklist(SIDE, "2026-07", "month", "REV");
    expect(july.ambiguous.map((l) => l.invoiceNoRaw)).toEqual(["INV-5"]);
  });
});
