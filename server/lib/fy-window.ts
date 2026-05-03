/**
 * Emergent Energy financial year window.
 *
 * The company FY runs Sep–Aug (matching every other FY-scoped figure
 * on the PD dashboard, including the existing `wonFy` KPI in
 * `/api/pd/reports`). FY label uses the calendar year of the August
 * close, e.g. the FY ending August 2026 is "FY26".
 *
 * Centralised here so the won-deals tile, the PD reports endpoint and
 * any future FY-scoped read-only roll-up share the same boundaries
 * without drift.
 */

export interface FyWindow {
  /** Calendar year of the August close (e.g. 2026 for FY26). */
  fy: number;
  /** Human label, e.g. "FY26 (Sep '25 – Aug '26)". */
  fyLabel: string;
  /** UTC midnight of 1 Sep, prior calendar year. */
  fyStart: Date;
  /** UTC end-of-day of 31 Aug, FY year. */
  fyEnd: Date;
  /** ISO calendar-day "YYYY-09-01", prior year. */
  fyStartIso: string;
  /** ISO calendar-day "YYYY-08-31", FY year. */
  fyEndIso: string;
}

function twoDigitYear(y: number): string {
  return String(y).slice(-2).padStart(2, "0");
}

/**
 * Resolve the FY window. With no input, returns the current FY based
 * on today's date. Pass `fy` to lock to a specific FY year (e.g. for
 * back-fill reports). Pass `date` to compute relative to a different
 * reference point (used by tests to pin the boundary deterministically).
 */
export function getFyWindow(input?: { fy?: number | null; date?: Date }): FyWindow {
  const ref = input?.date ?? new Date();
  // Sep–Aug window. Month is 0-indexed, so >= 8 means Sep–Dec → next FY.
  const currentFY = ref.getMonth() >= 8 ? ref.getFullYear() + 1 : ref.getFullYear();
  // Accept only positive integer FY; everything else (null/NaN/0/negative
  // /fractional) falls back to currentFY, matching the legacy `||` fallback.
  const fyCandidate = input?.fy;
  const fy = fyCandidate != null
    && Number.isFinite(fyCandidate)
    && Number.isInteger(fyCandidate)
    && (fyCandidate as number) > 0
    ? (fyCandidate as number)
    : currentFY;
  const fyStart = new Date(`${fy - 1}-09-01T00:00:00Z`);
  const fyEnd = new Date(`${fy}-08-31T23:59:59Z`);
  const fyStartIso = `${fy - 1}-09-01`;
  const fyEndIso = `${fy}-08-31`;
  const fyLabel = `FY${twoDigitYear(fy)} (Sep '${twoDigitYear(fy - 1)} – Aug '${twoDigitYear(fy)})`;
  return { fy, fyLabel, fyStart, fyEnd, fyStartIso, fyEndIso };
}
