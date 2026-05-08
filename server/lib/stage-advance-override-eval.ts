/**
 * Pure decision helper for the stage advance-to bulk-skip route.
 *
 * Plan v3 § 2.6 / D.6 #2: the legacy refusal at
 * stage-lifecycle-routes.ts:212 hard-coded
 * `ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"]`, blocking Programme and
 * Construction Managers even though they're the operational owners
 * of stage progression. Per AGENT_GUARDRAILS.md § 0A this is a soft
 * workflow rule — the right person + reason should pass.
 *
 * COO/CEO keep their existing reason-optional path (default). Other
 * authorised roles (per `stage_gate.override_roles` in the registry,
 * minus the default set) can advance via the override path with a
 * reason captured in audit.
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

  if (defaultRoles.has(userRole)) {
    return {
      kind: "advance",
      overrideApplied: false,
      reason: reasonProvided ? trimmedReason : null,
    };
  }

  if (!overrideRoles.has(userRole)) {
    return rejectForbidden(defaultRoles, overrideRoles);
  }

  if (!reasonProvided) {
    return {
      kind: "reject",
      status: 400,
      body: {
        error: "Stage advance requires a reason from your role.",
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
  defaultRoles: ReadonlySet<string>,
  overrideRoles: ReadonlySet<string>,
): StageAdvanceDecision {
  const allAuthorised = new Set<string>([...defaultRoles, ...overrideRoles]);
  const label = [...allAuthorised].sort().join(", ");
  return {
    kind: "reject",
    status: 403,
    body: {
      error: `Stage advance is restricted. Authorised roles: ${label}.`,
    },
  };
}
