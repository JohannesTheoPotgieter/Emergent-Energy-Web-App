/**
 * Shared priority constants — single source of truth for client + server.
 */

export type PriorityScope = "company" | "department" | "role";

export const PRIORITY_SCOPES: readonly PriorityScope[] = ["company", "department", "role"] as const;

export const PRIORITY_TERMINAL_STATUSES = [
  "closed",
  "complete",
  "completed",
  "cancelled",
  "canceled",
] as const;

export type PriorityTerminalStatus = (typeof PRIORITY_TERMINAL_STATUSES)[number];

export function isPriorityTerminalStatus(status: string | null | undefined): boolean {
  return !!status && PRIORITY_TERMINAL_STATUSES.includes(
    status.toLowerCase() as PriorityTerminalStatus,
  );
}

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

export function canPriorityRoleCreateScope(
  role: string | null | undefined,
  scope: PriorityScope,
): boolean {
  if (!role) return false;
  if (scope === "role") return true;
  if (isPriorityAdminRole(role)) return true;
  return isDepartmentHeadRole(role) && scope === "department";
}

export function canPriorityRoleUseAdminAction(role: string | null | undefined): boolean {
  return isPriorityAdminRole(role);
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

/**
 * Canonical department options for priority dialogs / filters.
 * Single source of truth — kept aligned with ROLE_DEPARTMENT_MAP in
 * shared/schema/users.ts so scope-department filters match the user map.
 */
export interface DepartmentOption {
  value: string;
  label: string;
}

export const DEPARTMENT_OPTIONS: readonly DepartmentOption[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "LEADERSHIP", label: "Leadership" },
  { value: "ENGINEERING", label: "Engineering" },
  { value: "PROJECT_DEVELOPMENT", label: "Project Development" },
  { value: "PROJECT_MANAGEMENT", label: "Project Management" },
  { value: "FINANCE", label: "Finance" },
] as const;

export function departmentLabel(key: string | null | undefined): string {
  if (!key) return "";
  return DEPARTMENT_OPTIONS.find((d) => d.value === key)?.label ?? key;
}

/**
 * Resolves all descendant priority IDs from a flat `[childId, parentId]`
 * adjacency list, starting from `rootId`. Does NOT include the root itself.
 *
 * Used by the rolled-up drill-down: a Company priority's "Tasks", "Approvals"
 * and financial totals aggregate across itself + every priority beneath it in
 * the tree. Pure function — the route layer loads the adjacency once and
 * delegates the traversal here so the logic is testable without a DB.
 *
 * Handles malformed input safely:
 *   - self-referential cycles (id === parentId)
 *   - multi-node cycles (A → B → A) via `visited` set
 *   - bounded depth (MAX_DEPTH) as a safety net
 */
export function collectDescendantIds(
  adjacency: ReadonlyArray<{ id: number; parentId: number | null }>,
  rootId: number,
  maxDepth = 20,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const row of adjacency) {
    if (row.parentId === null || row.parentId === row.id) continue;
    const bucket = childrenByParent.get(row.parentId);
    if (bucket) bucket.push(row.id);
    else childrenByParent.set(row.parentId, [row.id]);
  }

  const visited = new Set<number>();
  let frontier: number[] = [rootId];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next: number[] = [];
    for (const parent of frontier) {
      const kids = childrenByParent.get(parent);
      if (!kids) continue;
      for (const k of kids) {
        if (visited.has(k) || k === rootId) continue;
        visited.add(k);
        next.push(k);
      }
    }
    frontier = next;
    depth++;
  }
  return Array.from(visited);
}

/**
 * Resolves all ancestor priority IDs from a flat `[childId, parentId]`
 * adjacency list, starting from `leafId`. Does NOT include the leaf itself.
 *
 * Used by the bottom-up drill-down: a project's detail page lists every
 * priority it rolls up into — its directly-linked priorities PLUS every
 * ancestor up the chain. Mirrors `collectDescendantIds` so the top-down
 * and bottom-up views share a consistent traversal shape.
 *
 * Safe against self-cycles and multi-node cycles via a visited set, and
 * bounded by `maxDepth` against malformed data.
 */
export function collectAncestorIds(
  adjacency: ReadonlyArray<{ id: number; parentId: number | null }>,
  leafId: number,
  maxDepth = 20,
): number[] {
  const parentById = new Map<number, number | null>();
  for (const row of adjacency) {
    if (!parentById.has(row.id)) parentById.set(row.id, row.parentId ?? null);
  }

  const visited = new Set<number>();
  let current: number | null | undefined = parentById.get(leafId) ?? null;
  let depth = 0;
  while (current != null && depth < maxDepth && !visited.has(current) && current !== leafId) {
    visited.add(current);
    current = parentById.get(current) ?? null;
    depth++;
  }
  return Array.from(visited);
}

export interface PriorityListFilterRow {
  scope: PriorityScope;
  departmentKey: string | null;
  ownerUserId: number | null;
  assignedUserId: number | null;
}

export interface PriorityListFilterOptions {
  /** Null = caller didn't request a scope filter (defaults to 'company'). */
  scopeFilter: PriorityScope | null;
  /** Null = no department filter. */
  departmentFilter: string | null;
  /**
   * User IDs that belong to the target department via ROLE_DEPARTMENT_MAP.
   * When non-empty AND scope filter is 'department' AND a department filter
   * is set, role-scoped priorities owned or assigned to any of these users
   * are also included. This is how Department-head views pick up team
   * members' personal (role-scoped) priorities.
   */
  teamUserIds: ReadonlySet<number>;
}

/**
 * Pure predicate for the scope + department + team-role filter used by
 * `GET /api/priorities`. Extracted so the branching logic can be tested
 * without a DB or HTTP.
 *
 * Semantics:
 *   (1) row matches the primary scope + department filter, OR
 *   (2) row is a role-scoped priority owned or assigned to someone in the
 *       target department (team-role inclusion).
 */
export function matchesPriorityListFilter(
  row: PriorityListFilterRow,
  opts: PriorityListFilterOptions,
): boolean {
  const primaryScopeMatch = opts.scopeFilter
    ? row.scope === opts.scopeFilter
    : row.scope === "company";
  const primaryDeptMatch = !opts.departmentFilter || row.departmentKey === opts.departmentFilter;
  if (primaryScopeMatch && primaryDeptMatch) return true;

  // Team-role inclusion fires only when the caller is on the Department tab —
  // it's a widening of the department-scope query, not a general fallback.
  if (opts.scopeFilter !== "department" || opts.teamUserIds.size === 0 || row.scope !== "role") {
    return false;
  }
  if (row.ownerUserId !== null && opts.teamUserIds.has(row.ownerUserId)) return true;
  if (row.assignedUserId !== null && opts.teamUserIds.has(row.assignedUserId)) return true;
  return false;
}

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
