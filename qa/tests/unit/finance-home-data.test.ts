import { describe, expect, it } from "vitest";
import {
  cashByWeekSeries,
  fyHeadline,
  fyMonthFrame,
  gpMarginSeries,
  monthStatesSeries,
  onTrackGap,
  onTrackSeries,
  summariseTrust,
  tieState,
  topProjectsByGp,
  weakestMargins,
  type BudgetByMonth,
  type CashflowWeekRow,
  type MonthlyReconRow,
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
