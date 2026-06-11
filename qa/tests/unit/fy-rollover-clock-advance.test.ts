/**
 * FY-rollover clock-advance proof (chore/finance-detimebomb).
 *
 * Simulates the system clock at 2026-09-01 and 2027-01-01 — both INSIDE the
 * intended freeze window — and proves the finance period/year logic rolls into
 * FY27 with ZERO code change:
 *   - getFiscalYear (the single canonical source) and every helper that delegates
 *     to it report FY27 as current;
 *   - the FY27 window / month set / scope resolve correctly (data + periods);
 *   - FY26 stays viewable as a prior year;
 *   - the SAST boundary flips at 00:00 SAST on 1 Sep (not ~2h early in UTC).
 *
 * The server route loops that used to hardcode `new Date(Date.UTC(2025,8,1))`
 * now build their window from exactly these helpers (FY start = Sep of currentFY-1,
 * the 12 FY month keys), so this pins the rollover those call sites depend on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fiscalYearLabel,
  fiscalYearOfMonthKey,
  getFiscalYear,
  getFiscalYearBounds,
  getFiscalYearMonthKeys,
} from "@shared/fiscal-year";
import {
  getCurrentFinanceYear,
  getFinanceScopeMonthKeys,
  getFinanceYearBounds,
  resolveFinanceYearScope,
} from "../../../server/lib/finance-year-scope";
import {
  firstOfMonthSast,
  nthBusinessDayOfMonth,
  previousMonthFirst,
} from "../../../server/lib/finance/period-lock";

const FY27_MONTH_KEYS = [
  "2026-09", "2026-10", "2026-11", "2026-12",
  "2027-01", "2027-02", "2027-03", "2027-04",
  "2027-05", "2027-06", "2027-07", "2027-08",
];

afterEach(() => {
  vi.useRealTimers();
});

// Both instants are SAST midnight (UTC+2), the two clocks named in the task.
const FY27_CLOCKS: Array<[string, string]> = [
  ["first day of FY27 (1 Sep 2026, SAST)", "2026-09-01T00:00:00+02:00"],
  ["mid-FY27 (1 Jan 2027, SAST)", "2027-01-01T00:00:00+02:00"],
];

describe.each(FY27_CLOCKS)("clock advanced to %s → FY27 is current", (_label, iso) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  });

  it("the single canonical source resolves FY27", () => {
    expect(getFiscalYear()).toBe(2027);
    // Everything that derives 'current FY' must agree (single source).
    expect(getCurrentFinanceYear()).toBe(2027);
  });

  it("resolves the FY27 data window (REV/COS/GP + cashflow scope)", () => {
    const scope = resolveFinanceYearScope({});
    expect(scope).toMatchObject({
      mode: "fy",
      fy: 2027,
      label: "FY27",
      startDate: "2026-09-01",
      endDate: "2027-08-31",
      startMonthKey: "2026-09",
      endMonthKey: "2027-08",
    });
    // The 12-month loops (gp-tracker, program-dashboard) build their window from
    // exactly this set — proving they now cover FY27 instead of FY26.
    expect(getFinanceScopeMonthKeys(scope)).toEqual(FY27_MONTH_KEYS);
    expect(getFiscalYearMonthKeys(getFiscalYear())).toEqual(FY27_MONTH_KEYS);
    // The scenario-cashflow / fallback windows anchor on this start date.
    expect(getFinanceYearBounds(getCurrentFinanceYear()).startDate).toBe("2026-09-01");
  });

  it("opens FY27 periods (period-lock month arithmetic rolls forward)", () => {
    // A September-2026 effective date now resolves to the FY27 period 2026-09,
    // and the auto-lock 'previous month' / 'Nth business day' math is FY27-aware.
    const sept2026 = new Date("2026-09-15T09:00:00+02:00");
    expect(firstOfMonthSast(sept2026)).toBe("2026-09-01");
    expect(fiscalYearOfMonthKey(firstOfMonthSast(sept2026).slice(0, 7))).toBe(2027);
    // 3rd business day of Sep 2026 (no holidays) = Wed 3 Sep 2026.
    expect(nthBusinessDayOfMonth(2026, 9, 3, new Set())).toBe("2026-09-03");
    // Locking in Oct 2026 targets the Sep-2026 (FY27) period.
    expect(previousMonthFirst(new Date("2026-10-05T09:00:00+02:00"))).toBe("2026-09-01");
  });

  it("keeps FY26 viewable as a prior year", () => {
    const priorScope = resolveFinanceYearScope({ fy: "2026" });
    expect(priorScope).toMatchObject({
      mode: "fy",
      fy: 2026,
      label: "FY26",
      startDate: "2025-09-01",
      endDate: "2026-08-31",
    });
    expect(getFinanceYearBounds(2026)).toMatchObject({
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      label: "FY26",
    });
    expect(fiscalYearLabel(2026)).toBe("FY26");
  });

  it("breaks nothing — FY27 bounds are well-formed and self-consistent", () => {
    const b = getFiscalYearBounds(getFiscalYear());
    expect(b.startDate < b.endDate).toBe(true);
    expect(b.label).toBe("FY27");
    expect(fiscalYearOfMonthKey(b.startMonthKey)).toBe(2027);
    expect(fiscalYearOfMonthKey(b.endMonthKey)).toBe(2027);
  });
});

describe("SAST FY boundary flips at 00:00 SAST on 1 September (not early in UTC)", () => {
  afterEach(() => vi.useRealTimers());

  it("is still FY26 one second before the SAST boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T23:59:59+02:00"));
    expect(getFiscalYear()).toBe(2026);
    expect(getCurrentFinanceYear()).toBe(2026);
  });

  it("is FY27 exactly at the SAST boundary (22:00 UTC on 31 Aug = 00:00 SAST 1 Sep)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T22:00:00Z")); // == 2026-09-01T00:00 SAST
    expect(getFiscalYear()).toBe(2027);
    expect(getCurrentFinanceYear()).toBe(2027);
  });
});
