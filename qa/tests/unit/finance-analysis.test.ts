import { describe, it, expect } from "vitest";
import {
  bucketForDaysOverdue,
  computeEarnedVsInvoiced,
  daysOverdueOn,
  diffDays,
  emptyAgingCounts,
  parseIsoDate,
  resolveDueDate,
  rollupAging,
  topNConcentration,
  totalOutstanding,
} from "../../../server/lib/calculations/financeAnalysis";

const TODAY = new Date(Date.UTC(2026, 3, 29)); // 2026-04-29

describe("financeAnalysis — date helpers", () => {
  it("parses ISO date strings as UTC midnight", () => {
    const d = parseIsoDate("2026-04-01");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("returns null for blank, '-', or invalid input", () => {
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("-")).toBeNull();
    expect(parseIsoDate("not a date")).toBeNull();
  });

  it("accepts a Date instance directly", () => {
    const d = new Date(Date.UTC(2026, 0, 15)); // 2026-01-15
    const result = parseIsoDate(d);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("returns null for an invalid Date instance", () => {
    expect(parseIsoDate(new Date("invalid"))).toBeNull();
  });

  it("computes whole-day diffs ignoring timezone drift", () => {
    expect(diffDays(parseIsoDate("2026-04-29")!, parseIsoDate("2026-04-01")!)).toBe(28);
  });
});

describe("financeAnalysis — overdue bucketing", () => {
  it("buckets exactly per AR aging convention", () => {
    expect(bucketForDaysOverdue(0)).toBe("not_due");
    expect(bucketForDaysOverdue(1)).toBe("0_30");
    expect(bucketForDaysOverdue(30)).toBe("0_30");
    expect(bucketForDaysOverdue(31)).toBe("31_60");
    expect(bucketForDaysOverdue(60)).toBe("31_60");
    expect(bucketForDaysOverdue(61)).toBe("61_90");
    expect(bucketForDaysOverdue(90)).toBe("61_90");
    expect(bucketForDaysOverdue(91)).toBe("over_90");
    expect(bucketForDaysOverdue(365)).toBe("over_90");
  });

  it("days overdue is zero for future-dated invoices", () => {
    expect(daysOverdueOn(TODAY, parseIsoDate("2026-05-01"))).toBe(0);
  });

  it("returns 0 when due date is null (no due date set)", () => {
    expect(daysOverdueOn(TODAY, null)).toBe(0);
  });

  it("days overdue counts whole days past the due date", () => {
    expect(daysOverdueOn(TODAY, parseIsoDate("2026-03-30"))).toBe(30);
  });
});

describe("financeAnalysis — resolveDueDate modes", () => {
  it("strict mode uses expected date", () => {
    const due = resolveDueDate(
      { expectedDate: "2026-04-01", invoiceDate: "2026-03-01", termsDays: 60 },
      "expected_date",
    );
    expect(due!.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("payment-terms mode uses invoiceDate + termsDays", () => {
    const due = resolveDueDate(
      { expectedDate: "2026-04-01", invoiceDate: "2026-03-01", termsDays: 30 },
      "payment_terms",
    );
    expect(due!.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("payment-terms falls back to expected date when invoice date or terms missing", () => {
    expect(
      resolveDueDate({ expectedDate: "2026-04-01", invoiceDate: null, termsDays: 30 }, "payment_terms")!.toISOString(),
    ).toBe("2026-04-01T00:00:00.000Z");
    expect(
      resolveDueDate({ expectedDate: "2026-04-01", invoiceDate: "2026-03-01", termsDays: null }, "payment_terms")!.toISOString(),
    ).toBe("2026-04-01T00:00:00.000Z");
  });

  it("returns null when no usable date is available", () => {
    expect(resolveDueDate({ expectedDate: null }, "expected_date")).toBeNull();
    expect(resolveDueDate({ expectedDate: null, invoiceDate: null, termsDays: 30 }, "payment_terms")).toBeNull();
  });
});

describe("financeAnalysis — rollups", () => {
  it("rolls up amounts and counts into the right buckets", () => {
    const counts = rollupAging([
      { amount: 1000, daysOverdue: 0 },
      { amount: 500, daysOverdue: 10 },
      { amount: 200, daysOverdue: 45 },
      { amount: 100, daysOverdue: 91 },
    ]);
    expect(counts.not_due).toEqual({ count: 1, amount: 1000 });
    expect(counts["0_30"]).toEqual({ count: 1, amount: 500 });
    expect(counts["31_60"]).toEqual({ count: 1, amount: 200 });
    expect(counts.over_90).toEqual({ count: 1, amount: 100 });
    expect(totalOutstanding(counts)).toBe(1800);
  });

  it("returns all-zero buckets for an empty input", () => {
    const counts = rollupAging([]);
    expect(totalOutstanding(counts)).toBe(0);
    for (const v of Object.values(counts)) {
      expect(v).toEqual({ count: 0, amount: 0 });
    }
  });

  it("emptyAgingCounts has all keys at zero", () => {
    const counts = emptyAgingCounts();
    expect(totalOutstanding(counts)).toBe(0);
  });
});

describe("financeAnalysis — earned vs invoiced", () => {
  it("flags over-billed when invoiced exceeds earned by more than the band", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0.5,
      invoicedToDate: 600_000,
      toleranceBandPct: 10,
    });
    expect(result.earned).toBe(500_000);
    expect(result.invoiced).toBe(600_000);
    expect(result.variance).toBe(100_000);
    expect(result.variancePct).toBeCloseTo(0.2, 5);
    expect(result.flag).toBe("over_billed");
  });

  it("flags in-line within the tolerance band", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0.5,
      invoicedToDate: 525_000, // +5%
      toleranceBandPct: 10,
    });
    expect(result.flag).toBe("in_line");
  });

  it("flags under-billed when invoiced lags earned by more than the band", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0.5,
      invoicedToDate: 400_000, // -20%
      toleranceBandPct: 10,
    });
    expect(result.flag).toBe("under_billed");
  });

  it("clamps progress above 100% to 100%", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 1.5,
      invoicedToDate: 1_000_000,
      toleranceBandPct: 10,
    });
    expect(result.earned).toBe(1_000_000);
    expect(result.flag).toBe("in_line");
  });

  it("treats earned of zero as fully-overbilled when anything is invoiced", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0,
      invoicedToDate: 50_000,
      toleranceBandPct: 10,
    });
    expect(result.earned).toBe(0);
    expect(result.variancePct).toBe(1);
    expect(result.flag).toBe("over_billed");
  });

  it("toleranceBandPct of 0 flags any non-zero variance as out-of-line", () => {
    // Even a tiny variance is over_billed when band is 0%
    const over = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0.5,
      invoicedToDate: 500_001,
      toleranceBandPct: 0,
    });
    expect(over.flag).toBe("over_billed");

    // Exact match is in_line
    const exact = computeEarnedVsInvoiced({
      plannedExpenditure: 1_000_000,
      pctComplete: 0.5,
      invoicedToDate: 500_000,
      toleranceBandPct: 0,
    });
    expect(exact.flag).toBe("in_line");
  });

  it("plannedExpenditure of 0 with zero invoiced is in_line", () => {
    const result = computeEarnedVsInvoiced({
      plannedExpenditure: 0,
      pctComplete: 0.5,
      invoicedToDate: 0,
      toleranceBandPct: 10,
    });
    expect(result.earned).toBe(0);
    expect(result.variancePct).toBe(0);
    expect(result.flag).toBe("in_line");
  });
});

describe("financeAnalysis — concentration", () => {
  it("returns top-N share of total outstanding", () => {
    const rows = [
      { key: "A", amount: 500 },
      { key: "B", amount: 300 },
      { key: "C", amount: 100 },
      { key: "D", amount: 100 },
    ];
    const result = topNConcentration(rows, 2);
    expect(result.totalAmount).toBe(1000);
    expect(result.topAmount).toBe(800);
    expect(result.sharePct).toBeCloseTo(0.8, 5);
  });

  it("returns 0 share when total is zero", () => {
    const result = topNConcentration([], 5);
    expect(result.totalAmount).toBe(0);
    expect(result.topAmount).toBe(0);
    expect(result.sharePct).toBe(0);
  });
});
