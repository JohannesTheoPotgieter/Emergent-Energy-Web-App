/**
 * Engineering plan-link derivation — SINGLE SOURCE OF TRUTH.
 *
 * A plan-linked engineering task derives its due date from the linked
 * project-plan task's dates, and is flagged "urgent" as that derived deadline
 * nears. This logic was previously private to `engineering-tasks-repository.ts`;
 * it lives here (pure, no DB, no IO) so EVERY read surface — the Task Manager
 * list, the task detail, and the Engineering Home overdue/portfolio counts —
 * derives the same due date and cannot drift. It is also directly unit-testable
 * without a database.
 *
 *   - 'before' → plan.startDate − leadDays (the engineering task leads)
 *   - 'after'  → plan.endDate   + leadDays (the engineering task follows)
 */

import { isTaskComplete } from "@shared/task-status";

/** Relation a plan-linked engineering task can have to its plan task. */
export type PlanLinkRelation = "before" | "after";

/** The number of days from today within which a plan link is considered urgent. */
export const PLAN_LINK_URGENT_WINDOW_DAYS = 5;

/** Default lead/lag days when a link doesn't specify one. */
export const PLAN_LINK_DEFAULT_LEAD_DAYS = 5;

export interface DerivedPlanLink {
  /** The synced due date, or null if the needed plan date is missing. */
  derivedDue: string | null;
  /** The plan start ('before') or end ('after') date used to derive it. */
  planAnchorDate: string | null;
  /** Urgent = derivedDue set, task open, and derivedDue within 5 days or overdue. */
  planLinkUrgent: boolean;
}

/**
 * Add (or subtract) whole calendar days to a date-only string ("YYYY-MM-DD")
 * and return a date-only string. Uses UTC math so the result never drifts
 * across a DST / timezone boundary — `work_items.endDate` is a `date` column.
 */
export function shiftDateDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Whole-day difference (b − a) between two date-only strings. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const at = Date.UTC(ay, (am ?? 1) - 1, ad ?? 1);
  const bt = Date.UTC(by, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bt - at) / (24 * 60 * 60 * 1000));
}

/** Today as a date-only string in UTC, for whole-day urgency comparisons. */
export function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Derive the synced due date + urgency for a plan-linked engineering task from
 * the linked plan task's dates. Read-time authoritative: callers OVERRIDE the
 * persisted `endDate` with `derivedDue` so the due date stays correct if the
 * plan task's date later moves. If the needed plan date is missing, `derivedDue`
 * is null (no urgency).
 *
 * `today` is injectable so aggregations (e.g. Engineering Home) share the exact
 * "today" they use elsewhere, and so the function is deterministic in tests.
 */
export function derivePlanLink(args: {
  relation: string | null;
  leadDays: number | null;
  planStart: string | null;
  planEnd: string | null;
  taskStatus: string;
  today?: string;
}): DerivedPlanLink {
  const leadDays = args.leadDays ?? PLAN_LINK_DEFAULT_LEAD_DAYS;
  const anchor = args.relation === "before" ? args.planStart : args.relation === "after" ? args.planEnd : null;
  if (!anchor) return { derivedDue: null, planAnchorDate: null, planLinkUrgent: false };
  const derivedDue = shiftDateDays(anchor, args.relation === "before" ? -leadDays : leadDays);
  let planLinkUrgent = false;
  if (!isTaskComplete(args.taskStatus)) {
    const diff = dayDiff(args.today ?? todayDateStr(), derivedDue); // <0 overdue, 0..N upcoming
    planLinkUrgent = diff <= PLAN_LINK_URGENT_WINDOW_DAYS;
  }
  return { derivedDue, planAnchorDate: anchor, planLinkUrgent };
}

/**
 * The effective due date for an engineering task — the ONE rule every read
 * surface must apply so a task's "due"/"overdue" is identical in the list, the
 * detail drawer, and the Engineering Home counts.
 *
 * For a plan-linked task the derived due is AUTHORITATIVE: it overrides the
 * persisted `endDate` (and is null when the plan task has no usable date, which
 * reads as "no due date" — matching the Task Manager). For an unlinked task the
 * persisted `endDate` stands.
 */
export function effectiveEngineeringDueDate(row: {
  planLinkItemId: number | null;
  planLinkRelation: string | null;
  planLinkLeadDays: number | null;
  planStart: string | null;
  planEnd: string | null;
  endDate: string | null;
  status: string;
  today?: string;
}): string | null {
  if (row.planLinkItemId == null) return row.endDate ?? null;
  const derived = derivePlanLink({
    relation: row.planLinkRelation,
    leadDays: row.planLinkLeadDays,
    planStart: row.planStart,
    planEnd: row.planEnd,
    taskStatus: row.status,
    today: row.today,
  });
  return derived.derivedDue;
}
