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
  describe("RAG fallback", () => {
    it("uses stored ragStatus as 'manual' when present", () => {
      const out = composeProjectListSummaryRow(baseInput({ base: { ragStatus: "amber" } }));
      expect(out.ragStatus).toBe("amber");
      expect(out.ragSource).toBe("manual");
    });

    it("derives RAG from work_items overdue count when stored is null", () => {
      // 0 overdue → green, 1-3 → amber, >3 → red (per computeScheduleRag)
      const green = composeProjectListSummaryRow(baseInput({ liveTask: { avgPct: 50, overdueCount: 0, totalCount: 10 } }));
      expect(green.ragStatus).toBe("green");
      expect(green.ragSource).toBe("derived");

      const amber = composeProjectListSummaryRow(baseInput({ liveTask: { avgPct: 50, overdueCount: 2, totalCount: 10 } }));
      expect(amber.ragStatus).toBe("amber");
      expect(amber.ragSource).toBe("derived");

      const red = composeProjectListSummaryRow(baseInput({ liveTask: { avgPct: 50, overdueCount: 7, totalCount: 10 } }));
      expect(red.ragStatus).toBe("red");
      expect(red.ragSource).toBe("derived");
    });

    it("returns null RAG with 'missing' source when no stored value and no tasks", () => {
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
        liveTask: { avgPct: 50, overdueCount: 0, totalCount: 10 },
      }));
      expect(derived.ragStatus).toBe("red");
    });
  });

  describe("% Complete fallback", () => {
    it("uses cached avgActualPctComplete when present, rounded", () => {
      const out = composeProjectListSummaryRow(baseInput({ base: { cachedPercentComplete: 73.6 } }));
      expect(out.percentComplete).toBe(74);
      expect(out.percentCompleteSource).toBe("cache");
    });

    it("falls back to live AVG(work_items.percent_complete) when cache is null", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: 41.3, overdueCount: 0, totalCount: 5 },
      }));
      expect(out.percentComplete).toBe(41);
      expect(out.percentCompleteSource).toBe("live");
    });

    it("returns null with 'missing' source when neither cache nor live available", () => {
      const out = composeProjectListSummaryRow(baseInput());
      expect(out.percentComplete).toBeNull();
      expect(out.percentCompleteSource).toBe("missing");
    });

    it("treats live avgPct=null (zero work_items rows) as missing, not 0%", () => {
      const out = composeProjectListSummaryRow(baseInput({
        liveTask: { avgPct: null, overdueCount: 0, totalCount: 0 },
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
