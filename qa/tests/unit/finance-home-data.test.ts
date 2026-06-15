import { describe, expect, it } from "vitest";
import {
  cashByWeekSeries,
  fyRealisedCos,
  fyRevenueTotals,
  monthStatesSeries,
  onTrackGap,
  onTrackSeries,
  summariseTrust,
  tieState,
  topProjectsByGp,
  weakestMargins,
  type CashflowWeekRow,
  type CosTrackerMonthRow,
  type ProjectLineRollup,
  type ReconPortfolioProjectRow,
  type RevTrackerMonthRow,
} from "@/lib/finance/home-data";

const revMonth = (over: Partial<RevTrackerMonthRow>): RevTrackerMonthRow => ({
  monthKey: "2025-09",
  monthLabel: "Sep 25",
  totalRevenue: 0,
  realisedRevenue: 0,
  unrealisedRevenue: 0,
  budget: 0,
  ytdRevenue: 0,
  ytdRealised: 0,
  ytdBudget: 0,
  realisedProjects: [],
  revProjects: [],
  unrealisedProjects: [],
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

describe("tieState — tie means tie-to-tracker, not internal consistency", () => {
  it("green WITH a tracker baseline is a tie", () => {
    expect(tieState("green", true)).toBe("tie");
  });
  it("green WITHOUT a baseline is 'not compared yet', never a tie", () => {
    expect(tieState("green", false)).toBe("not_compared");
  });
  it("amber / red are drift", () => {
    expect(tieState("amber", true)).toBe("drift");
    expect(tieState("red", true)).toBe("drift");
  });
  it("unlinked / unknown are not-compared (data not ready)", () => {
    expect(tieState("unlinked", false)).toBe("not_compared");
    expect(tieState("unknown", false)).toBe("not_compared");
  });
});

describe("summariseTrust", () => {
  it("counts tie / drift / not-compared correctly", () => {
    const counts = summariseTrust([
      reconRow({ projectId: 1, status: "green", trackerBaselinePresent: true }), // tie
      reconRow({ projectId: 2, status: "green", trackerBaselinePresent: false }), // not compared
      reconRow({ projectId: 3, status: "amber", trackerBaselinePresent: true }), // drift
      reconRow({ projectId: 4, status: "red", trackerBaselinePresent: true }), // drift
      reconRow({ projectId: 5, status: "unknown", trackerBaselinePresent: false }), // not compared
    ]);
    expect(counts).toEqual({ tie: 1, drift: 2, notCompared: 2 });
  });
});

describe("FY headline totals (FYTD, incl. open month)", () => {
  it("sums realised across months and budget across the FY", () => {
    const months = [
      revMonth({ monthKey: "2025-09", realisedRevenue: 100, budget: 120 }),
      revMonth({ monthKey: "2025-10", realisedRevenue: 200, budget: 150 }),
      revMonth({ monthKey: "2025-11", realisedRevenue: 0, budget: 130 }),
    ];
    expect(fyRevenueTotals(months)).toEqual({ realisedFytd: 300, budgetFy: 400 });
  });

  it("sums realised COS", () => {
    const cos: CosTrackerMonthRow[] = [
      { monthKey: "2025-09", monthLabel: "Sep", budget: 0, realisedCOS: 80, realisedProjects: [] },
      { monthKey: "2025-10", monthLabel: "Oct", budget: 0, realisedCOS: 120, realisedProjects: [] },
    ];
    expect(fyRealisedCos(cos)).toBe(200);
  });
});

describe("monthStatesSeries — budget · planned · realised", () => {
  it("planned = unrealised forecast portion", () => {
    const series = monthStatesSeries([
      revMonth({ monthKey: "2025-09", budget: 120, realisedRevenue: 100, unrealisedRevenue: 40 }),
    ]);
    expect(series[0]).toMatchObject({ budget: 120, planned: 40, realised: 100 });
  });
});

describe("onTrackSeries + gap", () => {
  const months = [
    revMonth({ monthKey: "2025-09", realisedRevenue: 100, budget: 120 }),
    revMonth({ monthKey: "2025-10", realisedRevenue: 150, budget: 100 }),
  ];
  it("accumulates realised and budget", () => {
    const s = onTrackSeries(months);
    expect(s[1]).toMatchObject({ cumRealised: 250, cumBudget: 220 });
  });
  it("gap = cumulative realised − budget at the current month (ahead = positive)", () => {
    const s = onTrackSeries(months);
    expect(onTrackGap(s, "2025-10")).toBe(30);
    expect(onTrackGap(s, "2025-09")).toBe(-20);
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

describe("top GP / weakest margins", () => {
  const byProject: ProjectLineRollup[] = [
    { projectId: 1, revenue: 1000, gp: 300, gpPct: 30, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null, count: 1 },
    { projectId: 2, revenue: 1000, gp: 50, gpPct: 5, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null, count: 1 },
    { projectId: 3, revenue: 1000, gp: -100, gpPct: -10, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null, count: 1 },
  ];
  const names = new Map([[1, "Alpha"], [2, "Beta"], [3, "Gamma"]]);

  it("top GP is descending by GP", () => {
    expect(topProjectsByGp(byProject, names).map((p) => p.projectId)).toEqual([1, 2, 3]);
  });
  it("weakest margins is ascending by GP%", () => {
    expect(weakestMargins(byProject, names).map((p) => p.projectId)).toEqual([3, 2, 1]);
  });
});
