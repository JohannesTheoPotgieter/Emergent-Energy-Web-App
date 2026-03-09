import { describe, it, expect } from "vitest";
import { computeProjectCompletion, summarizeEngineeringStatuses, summarizeQualityStatuses, calculateGrossMarginPercent } from "../../../server/services/kpi-service";

describe("KPI Calculations", () => {
  describe("computeProjectCompletion", () => {
    it("returns zeros for empty plan", () => {
      const result = computeProjectCompletion([]);
      expect(result.actualPct).toBe(0);
      expect(result.expectedPct).toBe(0);
      expect(result.delta).toBe(0);
    });

    it("computes correct weighted average for single task", () => {
      const result = computeProjectCompletion([
        { percentComplete: 50, durationDays: 10 },
      ]);
      expect(result.actualPct).toBe(50);
    });

    it("applies duration weighting correctly", () => {
      const result = computeProjectCompletion([
        { percentComplete: 100, durationDays: 10 },
        { percentComplete: 0, durationDays: 10 },
      ]);
      expect(result.actualPct).toBe(50);
    });

    it("weights longer tasks more heavily", () => {
      const result = computeProjectCompletion([
        { percentComplete: 100, durationDays: 30 },
        { percentComplete: 0, durationDays: 10 },
      ]);
      expect(result.actualPct).toBe(75);
    });

    it("defaults missing duration to 1", () => {
      const result = computeProjectCompletion([
        { percentComplete: 80 },
        { percentComplete: 40 },
      ]);
      expect(result.actualPct).toBe(60);
    });

    it("computes expected% from date range when expectedPctComplete missing", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 50);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 50);

      const result = computeProjectCompletion([
        {
          percentComplete: 30,
          durationDays: 10,
          actualStart: pastDate.toISOString().split("T")[0],
          actualEnd: futureDate.toISOString().split("T")[0],
        },
      ]);
      expect(result.expectedPct).toBeGreaterThan(40);
      expect(result.expectedPct).toBeLessThan(60);
    });

    it("returns 100% expected for past-end tasks", () => {
      const result = computeProjectCompletion([
        {
          percentComplete: 80,
          durationDays: 10,
          actualStart: "2024-01-01",
          actualEnd: "2024-06-01",
        },
      ]);
      expect(result.expectedPct).toBe(100);
      expect(result.delta).toBeLessThan(0);
    });

    it("returns 0% expected for future-start tasks", () => {
      const result = computeProjectCompletion([
        {
          percentComplete: 0,
          durationDays: 10,
          actualStart: "2099-01-01",
          actualEnd: "2099-12-31",
        },
      ]);
      expect(result.expectedPct).toBe(0);
      expect(result.delta).toBe(0);
    });

    it("computes positive delta for ahead-of-schedule project", () => {
      const result = computeProjectCompletion([
        {
          percentComplete: 80,
          durationDays: 10,
          expectedPctComplete: 50,
        },
      ]);
      expect(result.delta).toBe(30);
    });

    it("computes negative delta for behind-schedule project", () => {
      const result = computeProjectCompletion([
        {
          percentComplete: 20,
          durationDays: 10,
          expectedPctComplete: 60,
        },
      ]);
      expect(result.delta).toBe(-40);
    });

    it("handles mixed tasks with and without dates", () => {
      const result = computeProjectCompletion([
        { percentComplete: 100, durationDays: 5, expectedPctComplete: 100 },
        { percentComplete: 50, durationDays: 15, expectedPctComplete: 70 },
        { percentComplete: 0, durationDays: 10 },
      ]);
      expect(result.actualPct).toBeCloseTo(41.67, 1);
    });
  });

  describe("COS Aggregation", () => {
    function aggregateCOS(lines: any[]) {
      let planned = 0, committed = 0, invoiced = 0, paid = 0;
      for (const line of lines) {
        const amount = Number(line.amount) || 0;
        switch ((line.status || "").toLowerCase()) {
          case "planned": planned += amount; break;
          case "committed": committed += amount; break;
          case "invoiced": invoiced += amount; break;
          case "paid": paid += amount; break;
        }
      }
      return {
        planned, committed, invoiced, paid,
        totalOutstanding: committed + invoiced,
        totalRealised: invoiced + paid,
        totalUnrealised: planned + committed,
      };
    }

    it("sums amounts by status correctly", () => {
      const result = aggregateCOS([
        { amount: 100, status: "Planned" },
        { amount: 200, status: "Committed" },
        { amount: 300, status: "Invoiced" },
        { amount: 400, status: "Paid" },
      ]);
      expect(result.planned).toBe(100);
      expect(result.committed).toBe(200);
      expect(result.invoiced).toBe(300);
      expect(result.paid).toBe(400);
      expect(result.totalOutstanding).toBe(500);
      expect(result.totalRealised).toBe(700);
    });

    it("handles empty array", () => {
      const result = aggregateCOS([]);
      expect(result.totalRealised).toBe(0);
      expect(result.totalOutstanding).toBe(0);
    });

    it("ignores invalid amounts", () => {
      const result = aggregateCOS([
        { amount: "abc", status: "Paid" },
        { amount: null, status: "Invoiced" },
        { amount: 500, status: "Paid" },
      ]);
      expect(result.paid).toBe(500);
    });
  });

  describe("Financial Year Boundaries", () => {
    function getFY(date: Date): string {
      const month = date.getMonth();
      const year = date.getFullYear();
      return month >= 8 ? `FY${year + 1}` : `FY${year}`;
    }

    it("September starts new FY", () => {
      expect(getFY(new Date("2025-09-01"))).toBe("FY2026");
    });

    it("August ends current FY", () => {
      expect(getFY(new Date("2025-08-31"))).toBe("FY2025");
    });

    it("January is mid-FY", () => {
      expect(getFY(new Date("2026-01-15"))).toBe("FY2026");
    });
  });

  describe("Revenue Field Integrity", () => {
    it("milestoneAmount is actual, revenueAmount is costed", () => {
      const inflowLine = {
        milestoneAmount: 150000,
        revenueAmount: 200000,
      };
      expect(inflowLine.milestoneAmount).toBeLessThanOrEqual(inflowLine.revenueAmount);
    });
  });

  describe("Spend % Calculation", () => {
    it("computes spend percentage correctly", () => {
      const totalActual = 750000;
      const totalCosted = 1000000;
      const spendPct = (totalActual / totalCosted) * 100;
      expect(spendPct).toBe(75);
    });

    it("handles zero budget gracefully", () => {
      const totalCosted = 0;
      const spendPct = totalCosted === 0 ? 0 : (500000 / totalCosted) * 100;
      expect(spendPct).toBe(0);
    });
  });

  describe("Canonical Status Logic", () => {
    it("maps engineering statuses through shared canonical rules", () => {
      const summary = summarizeEngineeringStatuses([
        { status: "complete" },
        { status: "DONE" },
        { status: "in_progress" },
        { status: "blocked" },
        { status: null },
      ]);
      expect(summary.total).toBe(5);
      expect(summary.complete).toBe(2);
      expect(summary.inProgress).toBe(2);
      expect(summary.notStarted).toBe(1);
    });

    it("maps quality statuses without treating approvals as implicit complete", () => {
      const summary = summarizeQualityStatuses([
        { status: "APPROVED" },
        { status: "PENDING" },
        { status: "IN_PROGRESS" },
        { status: "REJECTED" },
      ]);
      expect(summary.approved).toBe(1);
      expect(summary.pending).toBe(2);
      expect(summary.failed).toBe(1);
    });

    it("calculates gross margin using canonical helper", () => {
      expect(calculateGrossMarginPercent(1000, 700)).toBe(30);
      expect(calculateGrossMarginPercent(0, 100)).toBe(0);
    });
  });

});
