/**
 * NCR status state machine (pure).
 *
 * Extracted from `quality-ncr-routes.ts` so the transition rules are
 * unit-testable without booting the route module (which pulls in the DB
 * pool + multer upload dirs). The route imports `canTransition` from here —
 * single source of truth.
 *
 * Forward-only chain:
 *   open → investigating → corrective_action → verification → closed
 * `waived` is reachable from any non-terminal state when an authorised user
 * records a waiver reason. `closed` and `waived` are terminal — no re-open.
 */
export const NCR_STATUS_ORDER = [
  "open",
  "investigating",
  "corrective_action",
  "verification",
  "closed",
] as const;

export type NcrLinearStatus = (typeof NCR_STATUS_ORDER)[number];

export const NCR_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["closed", "waived"]);

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (NCR_TERMINAL_STATUSES.has(from)) return false;
  if (to === "waived") return true;
  const fromIdx = NCR_STATUS_ORDER.indexOf(from as NcrLinearStatus);
  const toIdx = NCR_STATUS_ORDER.indexOf(to as NcrLinearStatus);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx === fromIdx + 1;
}
