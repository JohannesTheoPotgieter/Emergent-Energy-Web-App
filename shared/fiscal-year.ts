/**
 * Canonical Emergent Energy fiscal-year math — the SINGLE source of truth for
 * "which FY is it / what are an FY's boundaries" across client and server.
 *
 * The company FY runs September → August. The FY number/label is the calendar
 * year of the August close, e.g. FY26 = Sep 2025 → Aug 2026, FY27 = Sep 2026 →
 * Aug 2027. Nothing here is pinned to a specific year — every value is derived
 * from the supplied (or current) date, so the platform rolls into FY27 (and
 * every FY after) with ZERO code change.
 *
 * Anchored to SAST (Africa/Johannesburg, UTC+2, no DST) so the year boundary
 * flips at 00:00 SAST on 1 September, matching the frozen `server/lib/fy-window.ts`
 * and the finance-tracker surfaces. On a UTC server, reading the month without
 * the SAST shift would flip the FY ~2h early (the IMPORTER_AUDIT UTC-drift note).
 *
 * This module is isomorphic (pure `Date` math, no Node/DOM APIs) so the React
 * client and the Express server share the exact same derivation.
 */

/** Africa/Johannesburg is UTC+2 year-round (no daylight saving). */
const SAST_OFFSET_MS = 120 * 60 * 1000;

/**
 * Resolve the fiscal year (calendar year of the August close) for a date.
 * With no argument, resolves the CURRENT FY from "now".
 *
 *   getFiscalYear(new Date("2026-08-31")) === 2026  // still FY26
 *   getFiscalYear(new Date("2026-09-01")) === 2027  // rolled into FY27
 */
export function getFiscalYear(date: Date = new Date()): number {
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  // Month is 0-indexed on the SAST-shifted clock; Sep (8) … Dec → next FY.
  return sast.getUTCMonth() >= 8 ? sast.getUTCFullYear() + 1 : sast.getUTCFullYear();
}

/** Short FY label, e.g. 2026 → "FY26". */
export function fiscalYearLabel(fy: number): string {
  return `FY${String(fy).slice(-2).padStart(2, "0")}`;
}

export interface FiscalYearBounds {
  /** Calendar year of the August close (e.g. 2026 for FY26). */
  fy: number;
  /** Short label, e.g. "FY26". */
  label: string;
  /** Inclusive ISO start day, "YYYY-09-01" of the prior calendar year. */
  startDate: string;
  /** Inclusive ISO end day, "YYYY-08-31" of the FY year. */
  endDate: string;
  /** Start month key, "YYYY-09" of the prior calendar year. */
  startMonthKey: string;
  /** End month key, "YYYY-08" of the FY year. */
  endMonthKey: string;
}

/** Calendar boundaries of a given FY. Pure function of `fy` (no date anchoring). */
export function getFiscalYearBounds(fy: number): FiscalYearBounds {
  const startYear = fy - 1;
  return {
    fy,
    label: fiscalYearLabel(fy),
    startDate: `${startYear}-09-01`,
    endDate: `${fy}-08-31`,
    startMonthKey: `${startYear}-09`,
    endMonthKey: `${fy}-08`,
  };
}

/** The 12 month keys ("YYYY-MM") of an FY, in calendar order Sep → Aug. */
export function getFiscalYearMonthKeys(fy: number): string[] {
  const startYear = fy - 1;
  const keys: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const monthIndex = (8 + i) % 12; // Sep=8 … Dec=11, Jan=0 … Aug=7
    const year = monthIndex >= 8 ? startYear : fy;
    keys.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * The FY that contains a given month key ("YYYY-MM"). Sep–Dec belong to the
 * next FY; Jan–Aug to the same calendar year. Falls back to the current FY for
 * an unparseable key. Lets period-scoped reads derive the FY window from the
 * month being viewed instead of assuming "this year".
 */
export function fiscalYearOfMonthKey(monthKey: string | null | undefined): number {
  const match = /^(\d{4})-(\d{2})/.exec(String(monthKey ?? ""));
  if (!match) return getFiscalYear();
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-indexed
  return month >= 9 ? year + 1 : year;
}
