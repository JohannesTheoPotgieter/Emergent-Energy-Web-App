/**
 * Pure decision helper for the four QuickBooks mapping-lock refusal
 * sites in server/quickbooks-routes.ts (lines 1008, 1059, 1165, 1241).
 *
 * Plan v3 § 2.7 / D.6 #3: the legacy refusal hard-coded
 * `QB_ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"]`, blocking the CFO and
 * Programme Finance Manager from overwriting a locked QuickBooks
 * customer or vendor mapping. Per AGENT_GUARDRAILS.md § 0A this is a
 * soft workflow rule — the right finance authority + reason should pass.
 *
 * COO/CEO keep their reason-optional path (default). CFO and PFM
 * (per the registry expansion in the previous commit) gain an override
 * path that requires `override_reason` in the request body.
 *
 * The math of how the mapping drives revenue/expense reconciliation
 * is out of scope — this helper only governs the workflow gate.
 */

export type QbMappingLockDecision =
  | { kind: "proceed"; overrideApplied: false; reason: string | null }
  | { kind: "proceed_with_override"; overrideApplied: true; reason: string }
  | {
      kind: "reject";
      status: 400 | 403;
      body: {
        error: string;
        message: string;
        hint?: string;
        field?: string;
      };
    };

export interface EvaluateQbMappingLockParams {
  /** User's normalised company role. Undefined sessions get rejected. */
  userRole: string | undefined;
  /** Raw value of `req.body.override_reason` — guarded against non-strings. */
  rawOverrideReason: unknown;
  /**
   * Roles allowed via the default reason-optional path
   * (typically COO_ADMIN, CEO_ADMIN — preserved for backwards compat).
   */
  defaultRoles: ReadonlySet<string>;
  /**
   * All roles authorised to overwrite a locked mapping, including the
   * default set. The override-only roles are the difference. Sourced
   * from ENTITY_REGISTRY['financials'].override_roles.
   */
  overrideRoles: ReadonlySet<string>;
}

export function evaluateQbMappingLockDecision(
  params: EvaluateQbMappingLockParams,
): QbMappingLockDecision {
  const { userRole, rawOverrideReason, defaultRoles, overrideRoles } = params;

  const reasonProvided =
    typeof rawOverrideReason === "string" &&
    rawOverrideReason.trim().length > 0;
  const trimmedReason = reasonProvided
    ? (rawOverrideReason as string).trim()
    : "";

  if (!userRole) {
    return rejectForbidden(defaultRoles, overrideRoles);
  }

  if (defaultRoles.has(userRole)) {
    return {
      kind: "proceed",
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
        error: "override_reason_required",
        message:
          "This mapping is locked. Provide a non-empty `override_reason` " +
          "in the request body to record why the lock is being overwritten.",
        field: "override_reason",
        hint:
          "The reason is captured in the audit trail (changesJson) for " +
          "post-hoc review of finance overrides.",
      },
    };
  }

  return {
    kind: "proceed_with_override",
    overrideApplied: true,
    reason: trimmedReason,
  };
}

function rejectForbidden(
  defaultRoles: ReadonlySet<string>,
  overrideRoles: ReadonlySet<string>,
): QbMappingLockDecision {
  const allAuthorised = new Set<string>([...defaultRoles, ...overrideRoles]);
  const label = [...allAuthorised].sort().join(", ");
  return {
    kind: "reject",
    status: 403,
    body: {
      error: "mapping_locked",
      message:
        `This mapping is locked. Ask an authorised role to unlock or change it. ` +
        `Authorised roles: ${label}.`,
    },
  };
}
