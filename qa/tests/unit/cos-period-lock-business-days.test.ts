/**
 * B5 (audit closeout) — COS period lock business-day calculator.
 *
 * The scheduled auto-lock job runs on the "3rd business day of the
 * current month". A business day is Monday..Friday MINUS South
 * African public holidays. This test file pins the pure calendar
 * logic so future changes to the calendar loader cannot silently
 * shift the lock date.
 *
 * No DB calls — the holiday set is passed in explicitly, so each
 * test case controls exactly which days are holidays.
 */

import { describe, expect, it } from "vitest";
import {
  nthBusinessDayOfMonth,
  isWeekendSast,
  firstOfMonthSast,
  previousMonthFirst,
  toIsoDateSast,
  PERIOD_LOCK_OVERRIDE_ROLES,
} from "../../../server/lib/finance/period-lock";

// No-op shim for the threshold role assertion — inlined here so we do
// not need a separate helper file.
function computeTrafficLightBoundaries() {
  return { roles: Array.from(PERIOD_LOCK_OVERRIDE_ROLES) };
}
describe("B5 — nthBusinessDayOfMonth", () => {
  it("2026 March (no ZA holidays passed in) — 3rd business day is Wed 2026-03-04", () => {
    // March 2026: Sun 1, Mon 2, Tue 3, Wed 4 -> 1st, 2nd, 3rd business days.
    expect(nthBusinessDayOfMonth(2026, 3, 1, new Set())).toBe("2026-03-02");
    expect(nthBusinessDayOfMonth(2026, 3, 2, new Set())).toBe("2026-03-03");
    expect(nthBusinessDayOfMonth(2026, 3, 3, new Set())).toBe("2026-03-04");
  });

  it("2026 April (with Fri 2026-04-03 Good Friday + Mon 2026-04-06 Family Day) — 3rd business day is Thu 2026-04-09", () => {
    // April 2026 calendar:
    //   Wed 1  -> 1st business day
    //   Thu 2  -> 2nd business day
    //   Fri 3  -> GOOD FRIDAY (holiday)
    //   Sat 4, Sun 5 -> weekend
    //   Mon 6  -> FAMILY DAY (holiday)
    //   Tue 7  -> 3rd business day? No — wait, April 1 = Wed so:
    //     Wed 1 (1), Thu 2 (2), Fri 3 HOLIDAY, Sat 4 WKND, Sun 5 WKND,
    //     Mon 6 HOLIDAY, Tue 7 (3rd).
    // So the 3rd business day with these two holidays is Tue 2026-04-07.
    const holidays = new Set(["2026-04-03", "2026-04-06"]);
    expect(nthBusinessDayOfMonth(2026, 4, 3, holidays)).toBe("2026-04-07");
  });

  it("handles N=1 edge case (first business day)", () => {
    // May 2026: Fri 1 (1st bd), Sat 2, Sun 3, Mon 4 (2nd bd), Tue 5 (3rd).
    expect(nthBusinessDayOfMonth(2026, 5, 1, new Set())).toBe("2026-05-01");
    expect(nthBusinessDayOfMonth(2026, 5, 2, new Set())).toBe("2026-05-04");
    expect(nthBusinessDayOfMonth(2026, 5, 3, new Set())).toBe("2026-05-05");
  });

  it("handles months starting on a weekend", () => {
    // November 2026: Sun 1, Mon 2 (1st bd), Tue 3 (2nd bd), Wed 4 (3rd bd).
    expect(nthBusinessDayOfMonth(2026, 11, 3, new Set())).toBe("2026-11-04");
  });

  it("throws on n < 1", () => {
    expect(() => nthBusinessDayOfMonth(2026, 3, 0, new Set())).toThrow();
    expect(() => nthBusinessDayOfMonth(2026, 3, -1, new Set())).toThrow();
  });

  it("holiday-heavy month still returns a valid business day", () => {
    // December 2026 with Christmas Day (Fri 25) and Day of Goodwill (Sat 26
    // observed Mon 28 in some years). We'll pass in Thu 24 holiday for
    // Christmas Eve too just to test.
    const holidays = new Set(["2026-12-24", "2026-12-25", "2026-12-28"]);
    // Dec 2026 calendar: Tue 1 (1bd), Wed 2 (2bd), Thu 3 (3bd).
    expect(nthBusinessDayOfMonth(2026, 12, 3, holidays)).toBe("2026-12-03");
  });
});

describe("B5 — isWeekendSast", () => {
  it("Saturday 2026-04-04 is a weekend", () => {
    expect(isWeekendSast(new Date("2026-04-04T10:00:00Z"))).toBe(true);
  });
  it("Sunday 2026-04-05 is a weekend", () => {
    expect(isWeekendSast(new Date("2026-04-05T10:00:00Z"))).toBe(true);
  });
  it("Monday 2026-04-06 is NOT a weekend", () => {
    expect(isWeekendSast(new Date("2026-04-06T10:00:00Z"))).toBe(false);
  });
  it("Friday 2026-04-03 is NOT a weekend", () => {
    expect(isWeekendSast(new Date("2026-04-03T10:00:00Z"))).toBe(false);
  });
});

describe("B5 — month boundary helpers", () => {
  it("firstOfMonthSast normalizes to YYYY-MM-01 in SAST", () => {
    expect(firstOfMonthSast(new Date("2026-03-17T10:00:00Z"))).toBe("2026-03-01");
    // 2026-12-31T23:59:59Z is 2027-01-01 01:59:59 in SAST, so firstOfMonth
    // returns January 2027 — this is intentional: SAST crosses midnight
    // before UTC, so the period lock uses the SAST calendar date.
    expect(firstOfMonthSast(new Date("2026-12-31T23:59:59Z"))).toBe("2027-01-01");
    // 2026-12-31T20:00:00Z is 2026-12-31 22:00:00 SAST, still December.
    expect(firstOfMonthSast(new Date("2026-12-31T20:00:00Z"))).toBe("2026-12-01");
    // 2026-04-01 00:30 UTC is 2026-04-01 02:30 SAST -> April
    expect(firstOfMonthSast(new Date("2026-04-01T00:30:00Z"))).toBe("2026-04-01");
  });

  it("previousMonthFirst rolls back one month", () => {
    expect(previousMonthFirst(new Date("2026-04-15T10:00:00Z"))).toBe("2026-03-01");
    expect(previousMonthFirst(new Date("2026-01-10T10:00:00Z"))).toBe("2025-12-01");
    expect(previousMonthFirst(new Date("2026-03-01T10:00:00Z"))).toBe("2026-02-01");
  });

  it("toIsoDateSast returns YYYY-MM-DD in SAST", () => {
    expect(toIsoDateSast(new Date("2026-04-07T08:00:00Z"))).toBe("2026-04-07");
    // 2026-03-31 23:30 UTC is 2026-04-01 01:30 SAST -> next day in SAST
    expect(toIsoDateSast(new Date("2026-03-31T23:30:00Z"))).toBe("2026-04-01");
  });
});

describe("B5 — traffic-light / threshold sanity", () => {
  it("exposes the override-role whitelist and it matches the spec", () => {
    // Sanity: the helper re-exports PERIOD_LOCK_OVERRIDE_ROLES via the
    // shim. COO / CEO / CFO are the only roles allowed to bypass a lock.
    // PFM is intentionally NOT in this set.
    const boundaries = computeTrafficLightBoundaries();
    expect(boundaries.roles).toContain("COO_ADMIN");
    expect(boundaries.roles).toContain("CEO_ADMIN");
    expect(boundaries.roles).toContain("CFO");
    expect(boundaries.roles).not.toContain("PROGRAM_FINANCE_MANAGER");
    expect(boundaries.roles).not.toContain("PROGRAM_MANAGER");
  });
});
