/**
 * C6 — Status casing normalization.
 *
 * The codebase historically used 6 different status casings:
 *   - "TO DO" / "IN PROGRESS"            (UPPER + spaces, work items + deliverables)
 *   - "Not Started" / "Active"           (Title Case + spaces, work item default + TR)
 *   - "NOT_STARTED" / "PLANNED"          (UPPER_UNDERSCORE, stage lifecycle + finance)
 *   - "not_started" / "in_progress"      (lowercase_underscore, engineering + procurement)
 *   - "open" / "draft"                   (single-word lowercase)
 *   - "Red" / "Amber" / "Green"          (Title Case color names, TR RAG)
 *
 * Canonical form going forward: **lowercase_underscore**.
 *
 * Why: it matches the PostgreSQL enum convention, it's the most common
 * style in the codebase by table count, and it round-trips cleanly to
 * a human-readable label via `formatStatusLabel`.
 *
 * Migration 20260413_status_casing_normalization.sql normalizes every
 * existing row. This module gives the rest of the app two helpers:
 *   - `normalizeStatus(s)` — pure transform applied at every API
 *     boundary so the service layer can keep accepting legacy strings
 *     for one release while the clients catch up
 *   - `formatStatusLabel(s)` — inverse for UI display
 */

/**
 * Explicit map for legacy strings whose pure normalization would lose
 * meaning or produce the wrong canonical form. Anything not in this
 * map falls through to the generic transform.
 */
export const LEGACY_STATUS_MAP: Record<string, string> = {
  // work_items + deliverables (UPPER + spaces)
  "TO DO": "to_do",
  "IN PROGRESS": "in_progress",
  "NEEDS APPROVAL": "needs_approval",
  "QC APPROVED": "qc_approved",
  "PROVIDE FEEDBACK": "provide_feedback",
  "PROJECTS ASSISTANCE": "projects_assistance",
  "OPERATIONAL APPROVAL": "operational_approval",
  COMPLETE: "complete",
  HOLD: "hold",

  // work_items default (Title Case)
  "Not Started": "not_started",
  Active: "active",
  Completed: "completed",

  // stage lifecycle (UPPER_UNDERSCORE)
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  READY_FOR_REVIEW: "ready_for_review",
  APPROVED: "approved",
  PROGRESSED: "progressed",
  EXCEPTION_APPROVED: "exception_approved",
  BLOCKED: "blocked",
  REQUESTED: "requested",
  APPROVED_WITH_CONDITIONS: "approved_with_conditions",
  REJECTED: "rejected",
  CLOSED: "closed",
  RE_OPENED: "re_opened",
  WAITING: "waiting",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
  BYPASSED: "bypassed",
  NOT_APPLICABLE: "not_applicable",
  WAIVED: "waived",

  // finance line items (UPPER)
  PLANNED: "planned",
  INVOICED: "invoiced",
  PAID: "paid",
  IN_BANK: "in_bank",
  REALISED: "realised",

  // TR register (Title Case + color names)
  Red: "red",
  Amber: "amber",
  Green: "green",
  Linked: "linked",
  TaskCreated: "task_created",
  Done: "done",
  Suggested: "suggested",
  Accepted: "accepted",
  Rejected: "rejected",
  Suppressed: "suppressed",

  // smart import (UPPER_UNDERSCORE)
  PREVIEW: "preview",
  AWAITING_REVIEW: "awaiting_review",
  COMMITTED: "committed",
  ROLLED_BACK: "rolled_back",
  FAILED: "failed",
  SUPERSEDED: "superseded",

  // pattern match outcomes
  AUTO_APPLIED: "auto_applied",
  USER_CONFIRMED: "user_confirmed",
  USER_OVERRIDDEN: "user_overridden",
  UNRESOLVED: "unresolved",

  // allocation confidence
  DIRECT: "direct",
  HEADER_ERROR_POSITIONAL: "header_error_positional",
  PROVISIONAL: "provisional",
  MANUAL: "manual",

  // intake (UPPER + spaces)
  "NOT STARTED": "not_started",
  COMPLETED: "completed",
  "ON HOLD": "on_hold",
  CANCELLED: "cancelled",

  // risk levels (UPPER, used as severity)
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

/**
 * Pure transform: lowercase, replace spaces and dashes with
 * underscores, collapse repeated underscores, trim. Returns the
 * input unchanged if it's null/undefined/empty.
 *
 * For ambiguous legacy inputs (e.g. "TaskCreated" which should become
 * "task_created" not "taskcreated"), use `normalizeWithLegacy`.
 */
export function normalizeStatus(input: string | null | undefined): string {
  if (input == null) return "";
  const s = String(input).trim();
  if (s.length === 0) return "";
  return s
    .toLowerCase()
    .replace(/[-\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Legacy-aware normalizer: consults LEGACY_STATUS_MAP first so that
 * camelCase or composite legacy strings translate to the right
 * canonical form, then falls back to the generic transform.
 *
 * Use this at API boundaries (request bodies, import pipelines)
 * where you want to accept legacy strings transparently for one
 * release.
 */
export function normalizeWithLegacy(input: string | null | undefined): string {
  if (input == null) return "";
  const s = String(input).trim();
  if (s.length === 0) return "";
  if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS_MAP, s)) {
    return LEGACY_STATUS_MAP[s];
  }
  return normalizeStatus(s);
}

/**
 * Inverse: turn a canonical status into a human-readable label for
 * the UI. "in_progress" -> "In Progress", "ready_for_review" ->
 * "Ready For Review".
 */
export function formatStatusLabel(input: string | null | undefined): string {
  if (input == null) return "";
  const s = String(input).trim();
  if (s.length === 0) return "";
  return s
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Test-only: every legacy input that has been seen in the wild.
 * Used by the unit test to assert exhaustive coverage of the map.
 */
export const KNOWN_LEGACY_INPUTS = Object.keys(LEGACY_STATUS_MAP);
