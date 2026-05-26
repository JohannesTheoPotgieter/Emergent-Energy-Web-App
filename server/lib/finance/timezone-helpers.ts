/**
 * SAST timezone helpers — DF-3 fix per audit/FINANCE_AUDIT_V2_2026-05-26.md.
 *
 * EE is a South African company; all finance business dates are SAST (Africa/
 * Johannesburg, UTC+2 year-round, no DST). The dashboard and the per-project
 * drilldown must agree on what "current month" means, which means every
 * route MUST anchor to SAST regardless of the process timezone.
 *
 * Before this helper landed, three code paths existed:
 *
 *   1. `server/repositories/finance-line-level-repository.ts:186–189` —
 *      SAST-anchored, correct.
 *   2. `server/lifecycle-routes.ts:1326` — SAST-anchored, correct.
 *   3. `server/departments/finance-routes.ts:2838, 5348, 5506, 5675, 5928,
 *      6211` — UTC-anchored, WRONG; for the first 2 hours of each SAST day
 *      the UTC month differs from the SAST month, and the same line would
 *      classify as "past month" in the dashboard while being "current month"
 *      in the drilldown. The comment at 2836–2837 even said "must match
 *      cosCurrentMonthKey" but the implementations had drifted.
 *
 * Use this helper in every new route that needs "today SAST" or "current
 * month SAST". The repository path will continue to use its inline copy
 * for now (avoiding an import that crosses the repo / lib boundary), but
 * the values agree by construction.
 */

/** SAST is UTC+2 year-round; no DST. 120 minutes ahead of UTC. */
export const SAST_OFFSET_MINUTES = 120;
const SAST_OFFSET_MS = SAST_OFFSET_MINUTES * 60 * 1000;

/**
 * Returns "today" as a SAST calendar-day ISO string (YYYY-MM-DD). The slice
 * is safe because we already shifted the clock into SAST before formatting,
 * so the UTC representation of the shifted instant is the SAST calendar day.
 */
export function sastTodayIso(): string {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Returns the current month as a SAST month key (YYYY-MM). Used by every
 * § 3.2 / § 3.3 realisation predicate as the "current month" boundary
 * (lines whose recognition month equals this string are "current", lines
 * whose recognition month is strictly less are "past" and auto-promote).
 */
export function sastCurrentMonthKey(): string {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * Returns the SAST year + 1-indexed month for the supplied Date (default:
 * now). Use this when a route needs the month number itself, not the key
 * string. Process timezone is ignored.
 */
export function sastYearMonth(date: Date = new Date()): { year: number; month1Based: number } {
  const shifted = new Date(date.getTime() + SAST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month1Based: shifted.getUTCMonth() + 1 };
}
