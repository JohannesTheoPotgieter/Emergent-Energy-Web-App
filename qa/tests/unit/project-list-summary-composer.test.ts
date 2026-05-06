import { describe, it, expect } from "vitest";
import { composeProjectListSummaryRow } from "../../../server/services/project-platform-summary-service";

const baseInput = (overrides: any = {}) => ({
  base: {
    id: 42,
    name: "Mondi",
    phase: "S08_FINANCIAL_CLOSE",
    pmUserId: 7,
    pmName: "Alex",
    inDlp: false,
    ragStatus: null,
    cachedPercentComplete: null,
    cachedFinance: {
      totalRevenue: 0,
      totalCos: 0,
      grossProfit: 0,
      grossMarginPct: 0,
      revenueRealised: 0,
      cosRealised: 0,
    },
    ...overrides.base,
  },
  liveTask: overrides.liveTask ?? null,
  liveFinance: overrides.liveFinance ?? null,
});

describe("composeProjectListSummaryRow", () => {
  describe("RAG fallback (schedule-variance derivation)", () => {
    it("uses stored ragStatus as 'manual' when present", () => {
      const out = composeProjectListSummaryRow(baseInput({ base: { ragStatus: "amber" } }));
      expect(out.ragStatus).toBe("amber");
      expect(out.ragSource).toBe("manual");
    });

    it("derives green when actual is on or ahead of plan (variance >= -5)", () => {
      // 50% actual vs 53% expected → -3 → green
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 50, avgExpectedPct: 53, totalCount: 10 },
      }));
      expect(out.ragStatus).toBe("green");
      expect(out.ragSource).toBe("derived");
    });

    it("derives amber when slipping (-15 < variance < -5)", () => {
      // 40% actual vs 50% expected → -10 → amber
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 40, avgExpectedPct: 50, totalCount: 10 },
      }));
      expect(out.ragStatus).toBe("amber");
      expect(out.ragSource).toBe("derived");
    });

    it("derives red when significantly behind (variance < -15)", () => {
      // 20% actual vs 50% expected → -30 → red
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 20, avgExpectedPct: 50, totalCount: 10 },
      }));
      expect(out.ragStatus).toBe("red");
      expect(out.ragSource).toBe("derived");
    });

    it("returns null RAG with 'missing' source when no expected baseline exists", () => {
      // No expected_pct_complete on any task → can't compute variance →
      // shouldn't fabricate a colour from raw progress alone.
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 50, avgExpectedPct: null, totalCount: 10 },
      }));
      expect(out.ragStatus).toBeNull();
      expect(out.ragSource).toBe("missing");
    });

    it("returns null RAG when no stored value and no tasks", () => {
      const out = composeProjectListSummaryRow(baseInput());
      expect(out.ragStatus).toBeNull();
      expect(out.ragSource).toBe("missing");
    });

    it("DLP override forces red regardless of derived/stored value", () => {
      const stored = composeProjectListSummaryRow(baseInput({ base: { ragStatus: "green", inDlp: true } }));
      expect(stored.ragStatus).toBe("red");
      expect(stored.ragReason).toBe("In DLP");

      const derived = composeProjectListSummaryRow(baseInput({
        base: { inDlp: true },
        liveTask: { avgPct: 50, avgExpectedPct: 53, totalCount: 10 },
      }));
      expect(derived.ragStatus).toBe("red");
    });
  });

  describe("% Complete fallback", () => {
    it("uses cached avgActualPctComplete when > 0, rounded", () => {
      const out = composeProjectListSummaryRow(baseInput({ base: { cachedPercentComplete: 73.6 } }));
      expect(out.percentComplete).toBe(74);
      expect(out.percentCompleteSource).toBe("cache");
    });

    it("treats cached zero as a cache miss and falls back to live", () => {
      // The materialised derived_project_kpis row is initialised to 0 before
      // first refresh — surfacing "0%" for projects that already have task
      // progress is the bug this fix targets. Cached zero must not be
      // treated as authoritative.
      const out = composeProjectListSummaryRow(baseInput({
        base: { cachedPercentComplete: 0 },
        liveTask: { avgPct: 41.3, avgExpectedPct: 50, totalCount: 5 },
      }));
      expect(out.percentComplete).toBe(41);
      expect(out.percentCompleteSource).toBe("live");
    });

    it("falls back to live AVG when cache is null", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 41.3, avgExpectedPct: null, totalCount: 5 },
      }));
      expect(out.percentComplete).toBe(41);
      expect(out.percentCompleteSource).toBe("live");
    });

    it("returns null with 'missing' source when neither cache nor live available", () => {
      const out = composeProjectListSummaryRow(baseInput());
      expect(out.percentComplete).toBeNull();
      expect(out.percentCompleteSource).toBe("missing");
    });

    it("treats live totalCount=0 (no work_items) as missing, not 0%", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: null, avgExpectedPct: null, totalCount: 0 },
      }));
      expect(out.percentComplete).toBeNull();
      expect(out.percentCompleteSource).toBe("missing");
    });
  });

  describe("Finance fallback", () => {
    it("uses cache when any non-zero figure present", () => {
      const out = composeProjectListSummaryRow(baseInput({
        base: {
          cachedFinance: {
            totalRevenue: 1000, totalCos: 600, grossProfit: 400, grossMarginPct: 0.4,
            revenueRealised: 500, cosRealised: 300,
          },
        },
        liveFinance: { plannedRevenue: 9999, realisedRevenue: 0, plannedCost: 0, realisedCost: 0 },
      }));
      expect(out.totalRevenue).toBe(1000);
      expect(out.kpiSource).toBe("cache");
    });

    it("falls back to live normalized_cost_lines when cache is fully zero", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveFinance: { plannedRevenue: 2000, realisedRevenue: 1000, plannedCost: 1500, realisedCost: 800 },
      }));
      expect(out.totalRevenue).toBe(2000);
      expect(out.totalCos).toBe(1500);
      expect(out.grossProfit).toBe(500);
      expect(out.grossMarginPct).toBeCloseTo(0.25, 4);
      expect(out.revenueRealised).toBe(1000);
      expect(out.cosRealised).toBe(800);
      expect(out.kpiSource).toBe("live");
    });

    it("returns zeros with 'missing' source when neither cache nor live", () => {
      const out = composeProjectListSummaryRow(baseInput());
      expect(out.totalRevenue).toBe(0);
      expect(out.kpiSource).toBe("missing");
    });

    it("avoids divide-by-zero when live revenue is 0", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveFinance: { plannedRevenue: 0, realisedRevenue: 0, plannedCost: 100, realisedCost: 50 },
      }));
      expect(out.grossMarginPct).toBe(0);
    });
  });

  describe("Mondi-style cache-miss scenario (regression for the original bug)", () => {
    it("renders real RAG and % Complete for a project with no derived_project_kpis row", () => {
      // Repro: project in Financial Close phase, no manual rag_status set,
      // no derived_project_kpis cache row yet (avgActualPctComplete = null,
      // all finance figures = 0), but real work_items and cost lines exist.
      const out = composeProjectListSummaryRow(baseInput({
        base: {
          ragStatus: null,
          cachedPercentComplete: null,
          cachedFinance: {
            totalRevenue: 0, totalCos: 0, grossProfit: 0, grossMarginPct: 0,
            revenueRealised: 0, cosRealised: 0,
          },
        },
        liveTask: { avgPct: 65, avgExpectedPct: 75, totalCount: 28 },
        liveFinance: { plannedRevenue: 4_500_000, realisedRevenue: 3_200_000, plannedCost: 3_800_000, realisedCost: 2_900_000 },
      }));
      // % Complete must be the live 65% — not 0%
      expect(out.percentComplete).toBe(65);
      expect(out.percentCompleteSource).toBe("live");
      // RAG must be derived as amber (variance −10) — not "—"
      expect(out.ragStatus).toBe("amber");
      expect(out.ragSource).toBe("derived");
      // Finance must come from live cost lines, not zeros
      expect(out.totalRevenue).toBe(4_500_000);
      expect(out.kpiSource).toBe("live");
    });
  });

  it("preserves passthrough identity fields", () => {
    const out = composeProjectListSummaryRow(baseInput());
    expect(out.id).toBe(42);
    expect(out.name).toBe("Mondi");
    expect(out.phase).toBe("S08_FINANCIAL_CLOSE");
    expect(out.pmUserId).toBe(7);
    expect(out.pmName).toBe("Alex");
    expect(out.inDlp).toBe(false);
  });
});
