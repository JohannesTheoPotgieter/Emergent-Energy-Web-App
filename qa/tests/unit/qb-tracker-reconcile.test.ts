/**
 * Company-wide tracker-vs-QuickBooks reconcile engine (feat/qb-tracker-reconcile-engine).
 *
 * Pure tests over reconcileStream / summarise / period helpers — no DB, no QB.
 * Verifies four-way classification, period totals, GP = REV − COS each side, and
 * that a matched invoice booked in different fiscal periods flags `timing`
 * (NOT tracker_only/qb_only).
 */
import { describe, expect, it } from "vitest";

import {
  reconcileStream,
  summarise,
  periodKeyFor,
  isoWeekKey,
  type ReconInput,
  type ResolvePeriod,
} from "../../../server/services/qb-tracker-reconcile";

// Synthetic fiscal calendar: June = period 1, July = period 2.
const resolvePeriod: ResolvePeriod = (d) =>
  d == null ? null : d >= "2026-07-01" ? 2 : d >= "2026-06-01" ? 1 : null;

// COS fixture (default normalizer = digits_no_leading_zeros).
const qbCos: ReconInput[] = [
  { number: "BILL-100", amountExVat: 1000, date: "2026-06-10" }, // matched
  { number: "BILL-200", amountExVat: 2000, date: "2026-06-12" }, // matched (Δ within R1)
  { number: "BILL-300", amountExVat: 3000, date: "2026-06-15" }, // amount_variance
  { number: "QBONLY-9", amountExVat: 500, date: "2026-06-20" }, // qb_only
  { number: "TIMING-7", amountExVat: 7000, date: "2026-07-05" }, // timing: QB in July
];
const trCos: ReconInput[] = [
  { number: "100", amountExVat: 1000, date: "2026-06-10" },
  { number: "200", amountExVat: 2000.5, date: "2026-06-12" }, // Δ0.5 ≤ R1 → matched
  { number: "300", amountExVat: 3500, date: "2026-06-15" }, // Δ500 → amount_variance
  { number: "TRKONLY-5", amountExVat: 800, date: "2026-06-18" }, // tracker_only
  { number: "TIMING-7", amountExVat: 7000, date: "2026-06-28" }, // timing: tracker in June
];

// REV fixture (one clean match, so GP = REV − COS is exercised).
const qbRev: ReconInput[] = [{ number: "INV-100", amountExVat: 5000, date: "2026-06-10" }];
const trRev: ReconInput[] = [{ number: "100", amountExVat: 5000, date: "2026-06-10" }];

const cosLines = reconcileStream("COS", qbCos, trCos, resolvePeriod);
const revLines = reconcileStream("REV", qbRev, trRev, resolvePeriod);
const byKey = (key: string) => cosLines.find((l) => l.invoiceNoNorm === key)!;

describe("reconcileStream — four-way classification", () => {
  it("matched when number + amount agree within R1", () => {
    expect(byKey("100").status).toBe("matched");
    expect(byKey("100").delta).toBe(0);
    expect(byKey("200").status).toBe("matched"); // Δ0.5
  });
  it("amount_variance when number matches but amount differs > R1", () => {
    const v = byKey("300");
    expect(v.status).toBe("amount_variance");
    expect(v.delta).toBe(500); // tracker 3500 − qb 3000
  });
  it("tracker_only and qb_only for one-sided invoices", () => {
    expect(byKey("5").status).toBe("tracker_only");
    expect(byKey("5").qbAmountExVat).toBeNull();
    expect(byKey("9").status).toBe("qb_only");
    expect(byKey("9").trackerAmountExVat).toBeNull();
  });
  it("records both dates and the raw numbers", () => {
    const m = byKey("100");
    expect(m.trackerDate).toBe("2026-06-10");
    expect(m.qbDate).toBe("2026-06-10");
    expect(m.invoiceNoRaw).toContain("100");
  });
});

describe("timing — a matched invoice in different periods flags timing, not missing", () => {
  it("status stays matched, timingFlag is set, amount still ties", () => {
    const t = byKey("7");
    expect(t.status).toBe("matched"); // amounts tie (7000 = 7000)
    expect(t.timingFlag).toBe(true); // tracker June (p1) vs QB July (p2)
    expect(t.fiscalPeriodId).toBe(1); // primary date = tracker date (June)
    expect(t.delta).toBe(0);
  });
  it("a same-period match does NOT flag timing", () => {
    expect(byKey("100").timingFlag).toBe(false);
  });
});

describe("summarise — period totals + GP = REV − COS each side", () => {
  const cosMonth = summarise(cosLines, "month").find((r) => r.periodKey === "2026-06" && r.stream === "COS")!;
  const revMonth = summarise(revLines, "month").find((r) => r.periodKey === "2026-06" && r.stream === "REV")!;

  it("COS June totals roll the lines correctly", () => {
    // tracker: 1000 + 2000.5 + 3500 + 800 + 7000 = 14300.5
    expect(cosMonth.trackerTotal).toBeCloseTo(14300.5, 2);
    // qb: 1000 + 2000 + 3000 + 500 + 7000 = 13500
    expect(cosMonth.qbTotal).toBeCloseTo(13500, 2);
    // matched tracker value: 100 + 200 + timing-7 = 1000 + 2000.5 + 7000 = 10000.5
    expect(cosMonth.matchedTotal).toBeCloseTo(10000.5, 2);
    expect(cosMonth.varianceTotal).toBeCloseTo(500, 2); // |Δ| on the 300 line
    expect(cosMonth.trackerOnlyTotal).toBeCloseTo(800, 2);
    expect(cosMonth.qbOnlyTotal).toBeCloseTo(500, 2);
  });

  it("GP per period = REV − COS, each side", () => {
    const gpTracker = revMonth.trackerTotal - cosMonth.trackerTotal;
    const gpQb = revMonth.qbTotal - cosMonth.qbTotal;
    expect(gpTracker).toBeCloseTo(5000 - 14300.5, 2);
    expect(gpQb).toBeCloseTo(5000 - 13500, 2);
  });

  it("the same line dataset rolls to week and day as well", () => {
    const cosDay = summarise(cosLines, "day").filter((r) => r.stream === "COS");
    const cosWeek = summarise(cosLines, "week").filter((r) => r.stream === "COS");
    expect(cosDay.length).toBeGreaterThan(0);
    expect(cosWeek.length).toBeGreaterThan(0);
    // Day totals for a given date sum back into the month total.
    const dayTrackerSum = cosDay.reduce((s, r) => s + r.trackerTotal, 0);
    expect(dayTrackerSum).toBeCloseTo(cosMonth.trackerTotal, 2);
  });
});

describe("period key helpers", () => {
  it("day / month keys", () => {
    expect(periodKeyFor("2026-06-28", "day")).toBe("2026-06-28");
    expect(periodKeyFor("2026-06-28", "month")).toBe("2026-06");
  });
  it("ISO week key is stable and Monday-anchored", () => {
    // 2026-06-28 is a Sunday → ISO week 26 of 2026.
    expect(isoWeekKey("2026-06-28")).toBe("2026-W26");
    expect(periodKeyFor("2026-06-28", "week")).toBe("2026-W26");
  });
});
