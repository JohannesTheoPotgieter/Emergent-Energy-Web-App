/**
 * Fiscal-period backbone — backfill resolver.
 *
 * Acceptance (task step 4): every backfilled row resolves to exactly one fiscal
 * period; no row left unmatched. The backfill maps each periodised row's
 * month/week key to a fiscal_periods row by date-range containment. This test
 * pins that mapping against an FY26+FY27 calendar built to mirror
 * scripts/seed-fiscal-years.sql (Sep–Aug FY, monthly periods).
 */

import { describe, expect, it } from "vitest";

import {
  monthKeyToFirstOfMonth,
  periodsContainingDate,
  resolvePeriodIdForDate,
  resolvePeriodIdForMonthKey,
  type FiscalPeriodRow,
} from "../../../server/scripts/backfill-fiscal-period";

// 12 monthly periods for one Sep–Aug fiscal year. Mirrors the seed:
// period start = month first day, end = month last day.
function buildFyPeriods(startId: number, fyStartYear: number, fyStartMonth1: number): FiscalPeriodRow[] {
  const periods: FiscalPeriodRow[] = [];
  for (let i = 0; i < 12; i++) {
    const start = new Date(Date.UTC(fyStartYear, fyStartMonth1 - 1 + i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    periods.push({
      id: startId + i,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
  }
  return periods;
}

// FY26 = Sep 2025 → Aug 2026 (ids 1–12); FY27 = Sep 2026 → Aug 2027 (ids 13–24).
const periods: FiscalPeriodRow[] = [
  ...buildFyPeriods(1, 2025, 9),
  ...buildFyPeriods(13, 2026, 9),
];

// Every month key in the seeded range, "2025-09" … "2027-08".
function monthKeysInRange(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2025, 8 + i, 1)); // Sep 2025 = month index 8
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

describe("Fiscal-period backfill resolver", () => {
  it("calendar fixture is contiguous and non-overlapping (24 periods)", () => {
    expect(periods).toHaveLength(24);
    for (let i = 1; i < periods.length; i++) {
      // each period starts the day after the previous one ends
      expect(periods[i].startDate > periods[i - 1].endDate).toBe(true);
    }
  });

  it("every month_key in the calendar resolves to exactly one fiscal period (none unmatched)", () => {
    for (const mk of monthKeysInRange()) {
      const first = monthKeyToFirstOfMonth(mk)!;
      expect(periodsContainingDate(first, periods)).toHaveLength(1);
      expect(resolvePeriodIdForMonthKey(mk, periods)).not.toBeNull();
    }
  });

  it("week_start_date values (incl. month boundaries) resolve to exactly one period", () => {
    const samples = [
      "2025-09-01", "2025-09-29", "2026-01-01", "2026-01-26",
      "2026-08-31", "2026-12-28", "2027-08-01", "2027-08-31",
    ];
    for (const d of samples) {
      expect(periodsContainingDate(d, periods)).toHaveLength(1);
      expect(resolvePeriodIdForDate(d, periods)).not.toBeNull();
    }
  });

  it("maps keys to the correct period (FY runs Sep–Aug)", () => {
    expect(resolvePeriodIdForMonthKey("2025-09", periods)).toBe(1); // first month of FY26
    expect(resolvePeriodIdForMonthKey("2026-01", periods)).toBe(5); // Jan 2026 = 5th month of FY26
    expect(resolvePeriodIdForMonthKey("2026-08", periods)).toBe(12); // last month of FY26
    expect(resolvePeriodIdForMonthKey("2026-09", periods)).toBe(13); // first month of FY27
    expect(resolvePeriodIdForMonthKey("2027-08", periods)).toBe(24); // last month of FY27
    // week within Jan 2026 lands in the same period as the Jan month key
    expect(resolvePeriodIdForDate("2026-01-19", periods)).toBe(5);
  });

  it("keys outside the seeded calendar do not falsely match (coverage gaps stay visible)", () => {
    expect(resolvePeriodIdForMonthKey("2024-05", periods)).toBeNull();
    expect(resolvePeriodIdForMonthKey("2028-01", periods)).toBeNull();
    expect(resolvePeriodIdForDate("2025-08-31", periods)).toBeNull(); // Aug 2025 = FY25, not seeded
    expect(periodsContainingDate("2024-05-15", periods)).toHaveLength(0);
  });

  it("malformed or empty keys return null", () => {
    expect(resolvePeriodIdForMonthKey("", periods)).toBeNull();
    expect(resolvePeriodIdForMonthKey("garbage", periods)).toBeNull();
    expect(resolvePeriodIdForMonthKey(null, periods)).toBeNull();
    expect(resolvePeriodIdForDate(null, periods)).toBeNull();
  });
});
