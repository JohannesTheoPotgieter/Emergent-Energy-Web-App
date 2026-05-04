import { describe, it, expect } from "vitest";
import { getFinancialSummary } from "../../../server/repositories/finance-analysis-repository";

// Pinned reference date so FY-window math is deterministic. EE FY runs
// Sep–Aug, so 2026-04-15 is "FY26" (Sep '25 – Aug '26).
const NOW = new Date(Date.UTC(2026, 3, 15));
const FY26_START = "2025-09-01";
const TODAY_ISO = "2026-04-15";

function rev(amount: number, opts: { paid?: string; expected?: string; admin?: string } = {}) {
  return {
    amount: String(amount),
    expectedDate: opts.expected ?? null,
    adminOverride: opts.admin ?? null,
    paidDate: opts.paid ?? null,
  };
}

function cost(opts: {
  amount: number;
  budget?: number;
  invoice?: string;
  invoiceNo?: string;
  fontColor?: string;
  forecast?: string;
  paid?: string;
  status?: string;
}) {
  return {
    amount: String(opts.amount),
    budgetTotal: opts.budget != null ? String(opts.budget) : null,
    invoiceDate: opts.invoice ?? null,
    invoiceNumber: opts.invoiceNo ?? null,
    poNumber: null,
    forecastDate: opts.forecast ?? null,
    adminOverride: null,
    paidDate: opts.paid ?? null,
    status: opts.status ?? "planned",
    cosStatusOverride: null,
    cosRealised: null,
    invoiceDateFontColor: opts.fontColor ?? null,
    invoiceDateConfirmed: null,
  };
}

const NO_OPEX: Array<{ monthKey: string; amount: string | number | null }> = [];

describe("getFinancialSummary — period windows", () => {
  it("ytd uses FY-aligned window (Sep 1 → today)", async () => {
    const result = await getFinancialSummary({
      period: "ytd",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    });
    expect(result.from).toBe(FY26_START);
    expect(result.to).toBe(TODAY_ISO);
  });

  it("current_fy spans full FY (Sep 1 → Aug 31)", async () => {
    const result = await getFinancialSummary({
      period: "current_fy",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    });
    expect(result.from).toBe(FY26_START);
    expect(result.to).toBe("2026-08-31");
  });

  it("this_month covers the full calendar month", async () => {
    const result = await getFinancialSummary({
      period: "this_month",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    });
    expect(result.from).toBe("2026-04-01");
    expect(result.to).toBe("2026-04-30");
  });

  it("last_month covers the previous calendar month", async () => {
    const result = await getFinancialSummary({
      period: "last_month",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    });
    expect(result.from).toBe("2026-03-01");
    expect(result.to).toBe("2026-03-31");
  });

  it("custom requires from and to", async () => {
    await expect(getFinancialSummary({
      period: "custom",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    })).rejects.toThrow(/custom period requires/);
  });
});

describe("getFinancialSummary — revenue tile", () => {
  it("plan = expected payments in window; actual = paid in window; forecast adds unpaid expected", async () => {
    const result = await getFinancialSummary({
      period: "ytd",
      now: NOW,
      inputs: {
        revenueLines: [
          rev(100_000, { expected: "2026-02-01", paid: "2026-02-15" }), // counts in plan + actual + forecast
          rev(50_000,  { expected: "2026-03-01" }),                      // unpaid → plan + forecast (not actual)
          rev(30_000,  { expected: "2025-08-15", paid: "2025-08-20" }), // pre-FY → none
          rev(40_000,  { paid: "2026-02-01" }),                          // paid w/o expected → actual only
        ],
        costLines: [],
        opexBudget: NO_OPEX,
      },
    });
    const tile = result.metrics.find((m) => m.key === "revenue")!;
    expect(tile.plan).toBe(150_000);            // 100k + 50k
    expect(tile.actual).toBe(140_000);          // 100k + 40k
    expect(tile.forecast).toBe(190_000);        // 140k + 50k unpaid in window
  });

  it("admin date override wins over expectedPaymentDate for the plan window", async () => {
    const result = await getFinancialSummary({
      period: "this_month",
      now: NOW,
      inputs: {
        revenueLines: [
          // expected outside April, but admin override pulls it in
          rev(75_000, { expected: "2026-06-01", admin: "2026-04-10" }),
        ],
        costLines: [],
        opexBudget: NO_OPEX,
      },
    });
    expect(result.metrics.find((m) => m.key === "revenue")!.plan).toBe(75_000);
  });

  it("trend is a fixed 6 months ending on the reference month", async () => {
    const result = await getFinancialSummary({
      period: "this_month",
      now: NOW,
      inputs: {
        revenueLines: [
          rev(10_000, { paid: "2025-11-15" }),
          rev(20_000, { paid: "2026-04-05" }),
          rev(99_000, { paid: "2025-09-01" }), // outside trailing 6 → ignored
        ],
        costLines: [],
        opexBudget: NO_OPEX,
      },
    });
    const tile = result.metrics.find((m) => m.key === "revenue")!;
    expect(tile.trend.map((p) => p.month)).toEqual(["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]);
    expect(tile.trend.find((p) => p.month === "Nov")!.value).toBe(10_000);
    expect(tile.trend.find((p) => p.month === "Apr")!.value).toBe(20_000);
    expect(tile.trend.every((p) => p.value !== 99_000)).toBe(true);
  });
});

describe("getFinancialSummary — COS tile", () => {
  it("only canonical-realised lines (invoice + black font) count toward actual", async () => {
    const result = await getFinancialSummary({
      period: "ytd",
      now: NOW,
      inputs: {
        revenueLines: [],
        costLines: [
          // Realised: invoice + black font → counts.
          cost({ amount: 200_000, budget: 220_000, invoice: "2026-02-10", invoiceNo: "INV-001", fontColor: "black" }),
          // Not realised: red font → excluded from actual but counted as plan.
          cost({ amount: 80_000, budget: 90_000, invoice: "2026-03-15", invoiceNo: "INV-002", fontColor: "red", forecast: "2026-04-01" }),
          // No invoice yet, forecast in-window: pure plan + forecast.
          cost({ amount: 60_000, budget: 50_000, forecast: "2026-04-10" }),
          // Forecast outside the YTD window → excluded from plan and forecast.
          cost({ amount: 30_000, budget: 25_000, forecast: "2026-07-20" }),
          // Pre-FY realised line → ignored.
          cost({ amount: 999_000, budget: 999_000, invoice: "2025-07-15", invoiceNo: "INV-OLD", fontColor: "black" }),
        ],
        opexBudget: NO_OPEX,
      },
    });
    const tile = result.metrics.find((m) => m.key === "cos")!;
    expect(tile.plan).toBe(360_000);                  // 220k + 90k + 50k (in-window budgets)
    expect(tile.actual).toBe(200_000);                // only the realised in-window invoice
    expect(tile.forecast).toBe(340_000);              // 200k + 80k red-font + 60k pure-plan unrealised in window
  });

  it("plan uses budgetTotal, not amountExVat", async () => {
    const result = await getFinancialSummary({
      period: "this_month",
      now: NOW,
      inputs: {
        revenueLines: [],
        costLines: [
          cost({ amount: 5_000, budget: 100_000, forecast: "2026-04-20" }),
        ],
        opexBudget: NO_OPEX,
      },
    });
    expect(result.metrics.find((m) => m.key === "cos")!.plan).toBe(100_000);
  });
});

describe("getFinancialSummary — OpEx tile", () => {
  it("plan/actual/forecast all equal the in-window monthly budget sum", async () => {
    const result = await getFinancialSummary({
      period: "ytd",
      now: NOW,
      inputs: {
        revenueLines: [],
        costLines: [],
        opexBudget: [
          { monthKey: "2025-09", amount: "100000" }, // in window
          { monthKey: "2026-03", amount: "120000" }, // in window
          { monthKey: "2025-08", amount: "999999" }, // pre-FY → out
          { monthKey: "2026-07", amount: "777777" }, // future FY → after `to` (= today), so out
        ],
      },
    });
    const tile = result.metrics.find((m) => m.key === "opex")!;
    expect(tile.plan).toBe(220_000);
    expect(tile.actual).toBe(220_000);
    expect(tile.forecast).toBe(220_000);
  });
});

describe("getFinancialSummary — response shape", () => {
  it("always returns 3 tiles in revenue/cos/opex order with required fields", async () => {
    const result = await getFinancialSummary({
      period: "ytd",
      now: NOW,
      inputs: { revenueLines: [], costLines: [], opexBudget: NO_OPEX },
    });
    expect(result.metrics.map((m) => m.key)).toEqual(["revenue", "cos", "opex"]);
    for (const tile of result.metrics) {
      expect(typeof tile.label).toBe("string");
      expect(typeof tile.plan).toBe("number");
      expect(typeof tile.actual).toBe("number");
      expect(typeof tile.forecast).toBe("number");
      expect(tile.trend).toHaveLength(6);
    }
  });
});
