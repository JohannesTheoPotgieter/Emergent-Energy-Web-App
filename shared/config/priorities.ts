/**
 * Shared priority constants — single source of truth for client + server.
 */

export type PriorityScope = "company" | "department" | "role";

export const PRIORITY_SCOPES: readonly PriorityScope[] = ["company", "department", "role"] as const;

export const PRIORITY_ADMIN_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
] as const;

export type PriorityAdminRole = (typeof PRIORITY_ADMIN_ROLES)[number];

export function isPriorityAdminRole(role: string | null | undefined): boolean {
  return !!role && PRIORITY_ADMIN_ROLES.includes(role as PriorityAdminRole);
}

/** Roles that can manage department-level priorities (dept heads + admins) */
export const DEPARTMENT_HEAD_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
  "ENGINEERING_MANAGER",
  "QUALITY_MANAGER",
  "CONSTRUCTION_MANAGER",
  "HSE_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
] as const;

export type DepartmentHeadRole = (typeof DEPARTMENT_HEAD_ROLES)[number];

export function isDepartmentHeadRole(role: string | null | undefined): boolean {
  return !!role && DEPARTMENT_HEAD_ROLES.includes(role as DepartmentHeadRole);
}

/** Escalation reason types */
export type EscalationReason = "overdue" | "critical" | "blocked" | "manual";

export const ESCALATION_REASONS: readonly EscalationReason[] = ["overdue", "critical", "blocked", "manual"] as const;

/** Scope labels for display */
export const SCOPE_LABELS: Record<PriorityScope, string> = {
  company: "Company",
  department: "Department",
  role: "My Priorities",
};

export interface EscalatePatch {
  scope: PriorityScope;
  /** Set to null when the promotion removes the department association. */
  departmentKey: string | null;
  escalated: true;
  escalationReason: EscalationReason;
}

/**
 * Computes the update patch applied when a priority is escalated one scope up.
 * Role → Department (retains departmentKey), Department → Company (clears
 * departmentKey — it no longer applies). Company-scope priorities cannot be
 * escalated further; returns null in that case.
 *
 * Pure helper so the escalate handler's decision logic is testable without a DB.
 */
export function computeEscalatePatch(
  current: { scope: PriorityScope; departmentKey: string | null },
  reason: EscalationReason = "manual",
): EscalatePatch | null {
  if (current.scope === "company") return null;
  const nextScope: PriorityScope = current.scope === "role" ? "department" : "company";
  return {
    scope: nextScope,
    departmentKey: nextScope === "company" ? null : current.departmentKey,
    escalated: true,
    escalationReason: reason,
  };
}
