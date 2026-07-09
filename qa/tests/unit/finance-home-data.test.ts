import { describe, expect, it } from "vitest";
import {
  applyGrain,
  asAtHeadline,
  buildOnTrackChartRows,
  cashByWeekSeries,
  exceptionWatchList,
  fyHeadline,
  fyMonthFrame,
  gpMarginSeries,
  lastClosedMonthKey,
  monthStatesSeries,
  onTrackGap,
  onTrackSeries,
  runRateForecast,
  summariseTrust,
  tieState,
  toQuarterlyStates,
  topProjectsByGp,
  weakestMargins,
  type BudgetByMonth,
  type CashflowWeekRow,
  type MonthStatePoint,
  type MonthlyReconRow,
  type OnTrackPoint,
  type ProjectTotals,
  type ReconPortfolioProjectRow,
} from "@/lib/finance/home-data";

const month = (over: Partial<MonthlyReconRow>): MonthlyReconRow => ({
  monthKey: "2025-09",
  cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0,
  plannedCos: 0, plannedRevenue: 0, plannedGp: 0, plannedGpPct: null,
  realisedCos: 0, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null,
  ...over,
});

const proj = (over: Partial<ProjectTotals>): ProjectTotals => ({
  projectId: 1,
  cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0,
  plannedCos: 0, plannedRevenue: 0, plannedGp: 0, plannedGpPct: null,
  realisedCos: 0, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null,
  ...over,
});

const reconRow = (over: Partial<ReconPortfolioProjectRow>): ReconPortfolioProjectRow => ({
  projectId: 1,
  projectName: "P",
  status: "green",
  appVsTrackerDelta: 0,
  absDelta: 0,
  trackerBaselinePresent: true,
  ...over,
});

describe("fyMonthFrame", () => {
  it("generates the full FY month sequence from bounds", () => {
    const frame = fyMonthFrame([], { cos: {}, revenue: {} }, "2025-09", "2026-08");
    expect(frame).toHaveLength(12);
    expect(frame[0]).toBe("2025-09");
    expect(frame[11]).toBe("2026-08");
  });
  it("falls back to the union of data months when bounds are absent", () => {
    const frame = fyMonthFrame([month({ monthKey: "2025-10" })], { cos: {}, revenue: { "2025-09": 1 } }, null, null);
    expect(frame).toEqual(["2025-09", "2025-10"]);
  });
});

describe("fyHeadline — realised basis + FY budget target", () => {
  it("uses realised totals and sums the FY budget over the frame", () => {
    const total = month({ monthKey: "total", realisedRevenue: 300, realisedCos: 200, realisedGp: 100 });
    const budget: BudgetByMonth = { cos: {}, revenue: { "2025-09": 120, "2025-10": 150, "2030-01": 999 } };
    const h = fyHeadline(total, budget, ["2025-09", "2025-10"]);
    expect(h.realisedRevenue).toBe(300);
    expect(h.realisedCos).toBe(200);
    expect(h.realisedGp).toBe(100);
    expect(h.budgetRevenueFy).toBe(270); // out-of-frame 2030-01 excluded
    expect(h.marginPct).toBeCloseTo(33.33, 1);
  });
});

describe("monthStatesSeries — budget · planned · realised", () => {
  it("maps each FY month to its budget / planned / realised revenue", () => {
    const monthly = [month({ monthKey: "2025-09", plannedRevenue: 40, realisedRevenue: 100 })];
    const budget: BudgetByMonth = { cos: {}, revenue: { "2025-09": 120 } };
    const series = monthStatesSeries(monthly, budget, ["2025-09", "2025-10"]);
    expect(series[0]).toMatchObject({ budget: 120, planned: 40, realised: 100 });
    expect(series[1]).toMatchObject({ budget: 0, planned: 0, realised: 0 });
  });
});

describe("onTrackSeries + gap", () => {
  const monthly = [
    month({ monthKey: "2025-09", realisedRevenue: 100 }),
    month({ monthKey: "2025-10", realisedRevenue: 150 }),
  ];
  const budget: BudgetByMonth = { cos: {}, revenue: { "2025-09": 120, "2025-10": 100 } };
  const frame = ["2025-09", "2025-10"];
  it("accumulates realised and budget", () => {
    const s = onTrackSeries(monthly, budget, frame);
    expect(s[1]).toMatchObject({ cumRealised: 250, cumBudget: 220 });
  });
  it("gap = cumulative realised − budget at the current month (ahead = positive)", () => {
    const s = onTrackSeries(monthly, budget, frame);
    expect(onTrackGap(s, "2025-10")).toBe(30);
    expect(onTrackGap(s, "2025-09")).toBe(-20);
  });
});

describe("gpMarginSeries — realised GP + margin %", () => {
  it("derives margin % from realised GP / realised revenue", () => {
    const monthly = [month({ monthKey: "2025-09", realisedGp: 25, realisedRevenue: 100 })];
    const s = gpMarginSeries(monthly, ["2025-09"]);
    expect(s[0].gp).toBe(25);
    expect(s[0].margin).toBeCloseTo(25, 5);
  });
});

describe("cashByWeekSeries", () => {
  it("maps inflows / outflows / available", () => {
    const weeks: CashflowWeekRow[] = [
      {
        weekStart: "2025-09-01",
        weekEnd: "2025-09-08",
        projectInflows: 500,
        projectOutflows: 300,
        availablePayment: 200,
        hasAvailPayOverride: false,
      },
    ];
    expect(cashByWeekSeries(weeks)[0]).toMatchObject({ inflows: 500, outflows: 300, available: 200 });
  });
});

describe("top GP / weakest margins — realised basis", () => {
  const byProject: ProjectTotals[] = [
    proj({ projectId: 1, realisedRevenue: 1000, realisedGp: 300, realisedGpPct: 0.3 }),
    proj({ projectId: 2, realisedRevenue: 1000, realisedGp: 50, realisedGpPct: 0.05 }),
    proj({ projectId: 3, realisedRevenue: 1000, realisedGp: -100, realisedGpPct: -0.1 }),
  ];
  const names = new Map([[1, "Alpha"], [2, "Beta"], [3, "Gamma"]]);

  it("top GP is descending by realised GP", () => {
    expect(topProjectsByGp(byProject, names).map((p) => p.projectId)).toEqual([1, 2, 3]);
  });
  it("weakest margins is ascending by realised GP% (as a percentage)", () => {
    const weak = weakestMargins(byProject, names);
    expect(weak.map((p) => p.projectId)).toEqual([3, 2, 1]);
    expect(weak[0].gpPct).toBeCloseTo(-10, 5); // fraction → percentage
  });
});

describe("tieState / summariseTrust", () => {
  it("green WITH a baseline is a tie; green WITHOUT is 'not compared yet'", () => {
    expect(tieState("green", true)).toBe("tie");
    expect(tieState("green", false)).toBe("not_compared");
  });
  it("amber / red are drift; unlinked / unknown are not-compared", () => {
    expect(tieState("amber", true)).toBe("drift");
    expect(tieState("red", true)).toBe("drift");
    expect(tieState("unlinked", false)).toBe("not_compared");
    expect(tieState("unknown", false)).toBe("not_compared");
  });
  it("summarises the portfolio into tie / drift / not-compared", () => {
    const counts = summariseTrust([
      reconRow({ projectId: 1, status: "green", trackerBaselinePresent: true }),
      reconRow({ projectId: 2, status: "green", trackerBaselinePresent: false }),
      reconRow({ projectId: 3, status: "amber", trackerBaselinePresent: true }),
      reconRow({ projectId: 4, status: "red", trackerBaselinePresent: true }),
      reconRow({ projectId: 5, status: "unknown", trackerBaselinePresent: false }),
    ]);
    expect(counts).toEqual({ tie: 1, drift: 2, notCompared: 2 });
  });
});

// ── Finance Home upgrades — additive derivations ──────────────────────────────

describe("lastClosedMonthKey", () => {
  const frame = ["2025-09", "2025-10", "2025-11", "2025-12"];
  it("is the greatest frame month strictly before the open month", () => {
    expect(lastClosedMonthKey(frame, "2025-11")).toBe("2025-10");
  });
  it("is null when every frame month is in the future", () => {
    expect(lastClosedMonthKey(frame, "2025-09")).toBe(null);
  });
});

describe("asAtHeadline — closed vs include-open month", () => {
  const base = { inclOpenRevenue: 1000, inclOpenCos: 700, openRevenue: 120, openCos: 90 };
  it("include-open leaves the current totals byte-identical", () => {
    const h = asAtHeadline({ ...base, mode: "open" });
    expect(h.realisedRevenue).toBe(1000);
    expect(h.realisedCos).toBe(700);
    expect(h.grossProfit).toBe(300);
    expect(h.marginPct).toBeCloseTo(30, 5);
  });
  it("closed subtracts the open month's own realised", () => {
    const h = asAtHeadline({ ...base, mode: "closed" });
    expect(h.realisedRevenue).toBe(880);
    expect(h.realisedCos).toBe(610);
    expect(h.grossProfit).toBe(270);
    expect(h.openGp).toBe(30);
  });
});

describe("runRateForecast", () => {
  // Realised: Sep 100, Oct 150, Nov 200 (closed); Dec is the open month.
  const series: OnTrackPoint[] = [
    { monthKey: "2025-09", monthLabel: "Sep", cumRealised: 100, cumBudget: 120 },
    { monthKey: "2025-10", monthLabel: "Oct", cumRealised: 250, cumBudget: 240 },
    { monthKey: "2025-11", monthLabel: "Nov", cumRealised: 450, cumBudget: 360 },
    { monthKey: "2025-12", monthLabel: "Dec", cumRealised: 450, cumBudget: 480 },
    { monthKey: "2026-01", monthLabel: "Jan", cumRealised: 450, cumBudget: 600 },
  ];
  it("projects FY-close at the trailing 3-closed-month run-rate from the boundary", () => {
    // Run-rate = mean(100,150,200) = 150. Anchor at last closed month (Nov, cum 450).
    const f = runRateForecast(series, "2025-11", "2025-12", 3);
    expect(f.runRate).toBeCloseTo(150, 5);
    // Nov=450 anchor, Dec=600, Jan=750 → projectedFyClose 750.
    expect(f.projectedFyClose).toBeCloseTo(750, 5);
    expect(f.budgetFyClose).toBe(600);
    expect(f.gapToBudget).toBeCloseTo(150, 5); // ahead of budget in this synthetic set
    // Projection is null before the anchor, populated from the anchor forward.
    expect(f.points[0].projected).toBe(null);
    expect(f.points[2].projected).toBeCloseTo(450, 5);
    expect(f.points[4].projected).toBeCloseTo(750, 5);
  });
  it("returns an empty projection when there are no closed months", () => {
    const f = runRateForecast(series, null, "2025-09", 3);
    expect(f.projectedFyClose).toBe(null);
    expect(f.points.every((p) => p.projected === null)).toBe(true);
  });
});

describe("exceptionWatchList", () => {
  const names = new Map([[1, "Alpha"], [2, "Beta"], [3, "Gamma"], [4, "Delta"], [5, "Healthy"]]);
  const byProject: ProjectTotals[] = [
    proj({ projectId: 1, realisedRevenue: 1000, realisedGp: -200, realisedGpPct: -0.2 }), // negative GP
    proj({ projectId: 2, realisedRevenue: 1000, realisedGp: 30, realisedGpPct: 0.03 }),   // low margin (<5%)
    proj({ projectId: 3, realisedRevenue: 1000, realisedGp: 400, realisedGpPct: 0.4 }),   // healthy but drifts
    proj({ projectId: 5, realisedRevenue: 1000, realisedGp: 300, realisedGpPct: 0.3 }),   // healthy, no flag
  ];
  const recon: ReconPortfolioProjectRow[] = [
    reconRow({ projectId: 3, status: "red", absDelta: 5000, trackerBaselinePresent: true }),
    reconRow({ projectId: 5, status: "green", absDelta: 0, trackerBaselinePresent: true }),
  ];

  it("flags negative GP, low margin, and tracker drift; excludes healthy projects", () => {
    const list = exceptionWatchList(byProject, recon, names);
    const ids = list.rows.map((r) => r.projectId);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(ids).not.toContain(5);
    expect(list.totalFlagged).toBe(3);
  });

  it("ranks negative GP worst, then low margin, then drift", () => {
    const list = exceptionWatchList(byProject, recon, names);
    expect(list.rows[0].projectId).toBe(1); // negative GP dominates
    expect(list.rows[0].reasons).toContain("negative_gp");
    const gamma = list.rows.find((r) => r.projectId === 3)!;
    expect(gamma.reasons).toEqual(["tracker_drift"]);
    expect(gamma.drift).toBe(5000);
  });

  it("respects a custom margin threshold and top-N cap", () => {
    const list = exceptionWatchList(byProject, recon, names, { marginThreshold: 0.5, topN: 2 });
    // With a 50% floor, projects 2 and 5 now fall under it too.
    expect(list.rows).toHaveLength(2);
    expect(list.totalFlagged).toBeGreaterThan(2);
  });
});

describe("toQuarterlyStates / applyGrain", () => {
  const monthPoint = (over: Partial<MonthStatePoint>): MonthStatePoint => ({
    monthKey: "2025-09", monthLabel: "Sep", budget: 0, planned: 0, realised: 0, qb: 0, budgetSet: false, ...over,
  });
  const points: MonthStatePoint[] = [
    monthPoint({ monthKey: "2025-09", realised: 10, budget: 5 }),
    monthPoint({ monthKey: "2025-10", realised: 20, budget: 5 }),
    monthPoint({ monthKey: "2025-11", realised: 30, budget: 5, budgetSet: true }),
    monthPoint({ monthKey: "2025-12", realised: 40, budget: 5 }),
  ];
  it("folds three months into a quarter, summing states", () => {
    const q = toQuarterlyStates(points);
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({ monthLabel: "Q1", realised: 60, budget: 15, budgetSet: true });
    expect(q[1]).toMatchObject({ monthLabel: "Q2", realised: 40 });
  });
  it("applyGrain passes through for month grain", () => {
    expect(applyGrain(points, "month")).toBe(points);
    expect(applyGrain(points, "quarter")).toHaveLength(2);
  });
});

describe("buildOnTrackChartRows", () => {
  const actual: OnTrackPoint[] = [
    { monthKey: "2025-09", monthLabel: "Sep", cumRealised: 100, cumBudget: 120 },
    { monthKey: "2025-10", monthLabel: "Oct", cumRealised: 250, cumBudget: 240 },
  ];
  const prior: OnTrackPoint[] = [
    { monthKey: "2024-09", monthLabel: "Sep", cumRealised: 80, cumBudget: 100 },
    { monthKey: "2024-10", monthLabel: "Oct", cumRealised: 190, cumBudget: 210 },
  ];
  it("merges actual, projection and prior-FY overlay by index", () => {
    const forecast = runRateForecast(actual, "2025-10", "2025-11", 3);
    const rows = buildOnTrackChartRows(actual, forecast, prior);
    expect(rows[0]).toMatchObject({ cumRealised: 100, priorCumRealised: 80 });
    expect(rows[1].priorCumRealised).toBe(190);
    expect(rows[1].projected).toBeCloseTo(250, 5); // anchor at Oct
  });
  it("omits overlays when not requested", () => {
    const rows = buildOnTrackChartRows(actual, null, null);
    expect(rows[0].projected).toBeUndefined();
    expect(rows[0].priorCumRealised).toBeUndefined();
  });
});
