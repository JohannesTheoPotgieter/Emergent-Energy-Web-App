import { describe, expect, it } from "vitest";
import {
  resolveWeeklyAvailablePayment,
  selectCurrentWeek,
  type WeekLike,
} from "../../../server/lib/finance/weekly-cashflow-engine";

/**
 * The ONE weekly cash formula. These tests pin the defect that motivated the
 * cash-one-engine refactor: the live handler computed `opening + inflows`
 * (outflows never subtracted ⇒ a wildly inflated "available this week"). The
 * canonical formula is `opening + inflows − outflows`, and every surface reads
 * this one engine, so they cannot diverge.
 */
describe("resolveWeeklyAvailablePayment — opening + inflows − outflows", () => {
  it("subtracts outflows (regression guard for the opening+inflows bug)", () => {
    const r = resolveWeeklyAvailablePayment({ openingBalance: 1_000_000, inflows: 200_000, totalOutflows: 950_000 });
    // opening + inflows − outflows = 250,000 (NOT 1,200,000).
    expect(r.availablePayment).toBe(250_000);
    expect(r.computedAvailablePayment).toBe(250_000);
    expect(r.closingBalance).toBe(250_000);
    expect(r.hasAvailPayOverride).toBe(false);
    // The buggy "opening + inflows" would have been 1,200,000.
    expect(r.availablePayment).not.toBe(1_200_000);
  });

  it("can go negative (you can owe more than you hold this week)", () => {
    const r = resolveWeeklyAvailablePayment({ openingBalance: 100, inflows: 0, totalOutflows: 500 });
    expect(r.availablePayment).toBe(-400);
  });

  it("a manual override changes only the DISPLAYED value, never the carried balance", () => {
    const r = resolveWeeklyAvailablePayment({
      openingBalance: 1000,
      inflows: 500,
      totalOutflows: 200,
      override: { value: 250, reason: "cap to bank confirmation", updatedBy: "coo" },
    });
    expect(r.computedAvailablePayment).toBe(1300); // 1000 + 500 − 200
    expect(r.availablePayment).toBe(250); // override shown
    expect(r.closingBalance).toBe(1300); // real position carried forward, NOT the override
    expect(r.hasAvailPayOverride).toBe(true);
    expect(r.availPayReason).toBe("cap to bank confirmation");
    expect(r.availPayOverrideBy).toBe("coo");
  });

  it("running balance carries closingBalance (not the override) week to week", () => {
    // Week 1 overridden; week 2 opens on week 1's REAL closing, not the override.
    const w1 = resolveWeeklyAvailablePayment({
      openingBalance: 0,
      inflows: 1000,
      totalOutflows: 100,
      override: { value: 5 },
    });
    const w2 = resolveWeeklyAvailablePayment({ openingBalance: w1.closingBalance, inflows: 0, totalOutflows: 400 });
    expect(w1.closingBalance).toBe(900);
    expect(w1.availablePayment).toBe(5);
    expect(w2.computedAvailablePayment).toBe(500); // opens on 900, − 400
  });
});

describe("selectCurrentWeek — one rule, so every surface picks the same week", () => {
  const weeks: WeekLike[] = [
    { weekStart: "2026-01-05", weekEnd: "2026-01-12", availablePayment: 100 },
    { weekStart: "2026-01-12", weekEnd: "2026-01-19", availablePayment: 188_000 },
    { weekStart: "2026-01-19", weekEnd: "2026-01-26", availablePayment: 300 },
  ];

  it("picks the week containing today", () => {
    expect(selectCurrentWeek(weeks, "2026-01-14")?.availablePayment).toBe(188_000);
  });

  it("falls back to the first started week (the surfaces' exact rule), else null", () => {
    // After all weeks, find(containing) misses → find(weekStart ≤ today) returns
    // the first such week — byte-identical to Home/Weekly Close/Cashflow today.
    expect(selectCurrentWeek(weeks, "2026-02-01")?.availablePayment).toBe(100);
    expect(selectCurrentWeek(weeks, "2025-12-01")).toBeNull(); // before all → null
  });

  it("Home, Cashflow and Weekly Close resolve to ONE value for the week", () => {
    // All three surfaces read the same series + the same selector, so the
    // 'available this week' value is identical by construction (within R1).
    const today = "2026-01-14";
    const home = selectCurrentWeek(weeks, today)?.availablePayment ?? null;
    const cashflow = selectCurrentWeek(weeks, today)?.availablePayment ?? null;
    const weeklyClose = selectCurrentWeek(weeks, today)?.availablePayment ?? null;
    expect(Math.abs((home ?? 0) - (cashflow ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((home ?? 0) - (weeklyClose ?? 0))).toBeLessThanOrEqual(1);
  });
});
