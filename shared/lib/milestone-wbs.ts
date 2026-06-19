/**
 * Canonical milestone classification rule for the project plan / WBS.
 *
 * Owner rule (2026-06-19): a milestone is a TOP-LEVEL INTEGER WBS row
 * ("1", "2", "3", … with no dot), and never a decimal sub-row ("1.1",
 * "5.3", …). This is the single source of truth used by both the Smart
 * Import path (which sets the stored `is_milestone` flag) and every read
 * path that displays the plan/schedule, so the two can never disagree.
 *
 * Deliberately NOT keyword- or duration-based: the previous heuristic
 * (name keyword OR zero-duration leaf) put milestone markers on decimal
 * sub-tasks, which is exactly what this replaces.
 */
export function isMilestoneWbs(wbs: string | null | undefined): boolean {
  if (wbs == null) return false;
  return /^\d+$/.test(String(wbs).trim());
}
