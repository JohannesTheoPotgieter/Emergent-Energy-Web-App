/**
 * Pure decision helper for the stage advance-to bulk-skip route.
 *
 * Protected EPC control: bulk stage advance is a bypass. It requires
 * COO_ADMIN and a written reason, even when broader stage_gate edit or
 * override roles exist in the registry.
 */

export type StageAdvanceDecision =
  | { kind: "advance"; overrideApplied: false; reason: string | null }
  | { kind: "advance_with_override"; overrideApplied: true; reason: string }
  | {
      kind: "reject";
      status: 400 | 403;
      body: {
        error: string;
        hint?: string;
        field?: string;
      };
    };

export interface EvaluateStageAdvanceParams {
  /** User's normalised company role. Undefined sessions get rejected. */
  userRole: string | undefined;
  /** Raw value of `req.body.reason` — guarded against non-strings. */
  rawReason: unknown;
  /**
   * Roles allowed via the default reason-optional path (admin
   * backwards compat — typically COO_ADMIN, CEO_ADMIN).
   */
  defaultRoles: ReadonlySet<string>;
  /**
   * All roles authorised to advance, including the default set. The
   * override-only roles are the difference. Sourced from
   * ENTITY_REGISTRY['stage_gate'].override_roles.
   */
  overrideRoles: ReadonlySet<string>;
}

export function evaluateStageAdvanceDecision(
  params: EvaluateStageAdvanceParams,
): StageAdvanceDecision {
  const { userRole, rawReason, defaultRoles, overrideRoles } = params;

  const reasonProvided =
    typeof rawReason === "string" && rawReason.trim().length > 0;
  const trimmedReason = reasonProvided ? (rawReason as string).trim() : "";

  if (!userRole) {
    return rejectForbidden(defaultRoles, overrideRoles);
  }

  if (userRole !== "COO_ADMIN") {
    return rejectForbidden(defaultRoles, overrideRoles);
  }

  if (!reasonProvided) {
    return {
      kind: "reject",
      status: 400,
      body: {
          error: "Stage advance bypass requires COO approval and a written reason.",
        hint:
          "Provide a non-empty `reason` in the request body explaining " +
          "why this stage skip is necessary. The reason is recorded in " +
          "the project_stage_decisions audit trail.",
        field: "reason",
      },
    };
  }

  return {
    kind: "advance_with_override",
    overrideApplied: true,
    reason: trimmedReason,
  };
}

function rejectForbidden(
  _defaultRoles: ReadonlySet<string>,
  _overrideRoles: ReadonlySet<string>,
): StageAdvanceDecision {
  return {
    kind: "reject",
    status: 403,
    body: {
      error: "Stage advance bypass is restricted to COO_ADMIN.",
    },
  };
}
