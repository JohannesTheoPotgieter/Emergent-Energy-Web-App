/**
 * Pure decision helper for the PD-PM handover-accept route.
 *
 * Plan v3 § 2.5 / D.6 #1: the legacy refusal at handover-routes.ts:965-967
 * was a hard 400 whenever mandatory sections were incomplete, with no
 * authorised override path. Per AGENT_GUARDRAILS.md § 0A this is a soft
 * workflow rule — the right person + reason should pass.
 *
 * This helper centralises the three-way decision (accept / accept_with_override /
 * reject) so the route handler stays small and the security-critical branches
 * are unit-tested in isolation.
 */

export type HandoverAcceptDecision =
  | { kind: "accept"; overrideApplied: false }
  | { kind: "accept_with_override"; overrideApplied: true; reason: string }
  | {
      kind: "reject";
      status: 400;
      body: {
        error: string;
        missingItems?: unknown[];
        hint?: string;
        field?: string;
      };
    };

export interface EvaluateHandoverAcceptParams {
  /** User's normalised company role. May be undefined for unknown sessions. */
  userRole: string | undefined;
  /** The list of incomplete sections returned by computePdPmSubmitBlockers. */
  missingItems: unknown[];
  /** Raw value of `req.body.override_reason` — guarded against non-strings. */
  rawOverrideReason: unknown;
  /** Roles authorised to override missing-items per ENTITY_REGISTRY['handover']. */
  overrideRoles: ReadonlySet<string>;
}

export function evaluateHandoverAcceptDecision(
  params: EvaluateHandoverAcceptParams,
): HandoverAcceptDecision {
  const { userRole, missingItems, rawOverrideReason, overrideRoles } = params;

  if (missingItems.length === 0) {
    return { kind: "accept", overrideApplied: false };
  }

  const reasonProvided =
    typeof rawOverrideReason === "string" && rawOverrideReason.trim().length > 0;
  const trimmedReason = reasonProvided
    ? (rawOverrideReason as string).trim()
    : "";
  const roleAuthorised = !!userRole && overrideRoles.has(userRole);

  // Render authorised roles from the (parameterised) set so the message stays
  // in sync with shared/permissions/registry.ts on future role-list changes.
  const authorisedRolesLabel = [...overrideRoles].sort().join(", ");

  if (!reasonProvided) {
    return {
      kind: "reject",
      status: 400,
      body: {
        error: "Cannot accept handover: mandatory sections are incomplete.",
        missingItems,
        hint:
          `An authorised role (${authorisedRolesLabel}) may override by ` +
          "submitting `override_reason` in the request body.",
        field: "override_reason",
      },
    };
  }

  if (!roleAuthorised) {
    return {
      kind: "reject",
      status: 400,
      body: {
        error:
          "override_reason provided, but your role is not authorised to override " +
          `an incomplete handover. Authorised roles: ${authorisedRolesLabel}.`,
        missingItems,
      },
    };
  }

  return {
    kind: "accept_with_override",
    overrideApplied: true,
    reason: trimmedReason,
  };
}
