/**
 * Commissioning item status state machine + Handover-Pack gate (pure).
 *
 * Extracted from `commissioning-routes.ts` for unit-testability (the route
 * module pulls in the DB pool). The route imports these — single source of
 * truth.
 *
 * Linear-with-rollback transitions:
 *   not_started ⇄ in_progress ⇄ ready_for_review → approved → closed
 * (`in_progress` may drop back to `not_started`; `ready_for_review` may drop
 * back to `in_progress`). `closed` is terminal.
 *
 * Gate: starting commissioning (`not_started → in_progress`) is blocked until
 * the Engineering Handover-Pack stage is `complete`.
 */
export const COMMISSIONING_VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ["in_progress"],
  in_progress: ["ready_for_review", "not_started"],
  ready_for_review: ["approved", "in_progress"],
  approved: ["closed"],
  closed: [],
};

export function canTransitionCommissioning(from: string, to: string): boolean {
  const allowed = COMMISSIONING_VALID_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/** The Handover-Pack engineering stage counts as complete only when its
 *  status is exactly "complete". */
export function isHandoverPackStageComplete(status: string | null | undefined): boolean {
  return status === "complete";
}

/**
 * The Handover-Pack gate. Starting commissioning (`not_started → in_progress`)
 * is blocked until the Handover-Pack stage is complete. Every other
 * transition is ungated by this rule.
 */
export function isCommissioningStartBlocked(
  from: string,
  to: string,
  handoverPackComplete: boolean,
): boolean {
  return from === "not_started" && to === "in_progress" && !handoverPackComplete;
}
