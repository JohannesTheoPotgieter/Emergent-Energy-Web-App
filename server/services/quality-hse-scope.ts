/**
 * Project-scope resolver for the Quality / HSE / Safety File function.
 *
 * Per AGENT_GUARDRAILS § 0A ("the app should never be a blocker for the right
 * people") and the registry's view_roles, the access model is:
 *
 *   - Function leads have COMPANY-WIDE oversight. Their role responsibility
 *     IS cross-project, so scoping them to "assigned" projects would defeat
 *     the job (the QM dashboard aggregates every project, etc.).
 *
 *       QUALITY_MANAGER, HSE_MANAGER, SSEG_MANAGER, ENGINEERING_MANAGER
 *
 *   - Other oversight roles inherited from FULL_OVERSIGHT_ROLES:
 *
 *       COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER,
 *       CONSTRUCTION_MANAGER, PROGRAM_FINANCE_MANAGER, ACCOUNTANT
 *
 *   - Everyone else is SCOPED to the projects they are assigned to via:
 *       1. project_info.pmUserId / pdUserId
 *       2. project_team_members
 *       3. entity_assignments (active, assignee=user)
 *
 *     This covers PROJECT_MANAGER_SITE, PROJECT_DEVELOPER, ENGINEER, and
 *     KEY_ACCOUNTS_MANAGER on quality/HSE/safety surfaces.
 */

import type { Request } from "express";
import { getEffectiveUser } from "../auth-context";
import { normalizeRoleForPermissions } from "@shared/schema";
import {
  resolveProjectScope,
  FULL_OVERSIGHT_ROLES,
  isProjectAccessible,
  isProjectAccessibleByName,
  type ProjectScope,
} from "./project-access-service";

const QUALITY_HSE_OVERSIGHT_ROLES: ReadonlySet<string> = new Set([
  ...FULL_OVERSIGHT_ROLES,
  "QUALITY_MANAGER",
  "HSE_MANAGER",
  "SSEG_MANAGER",
  "ENGINEERING_MANAGER",
]);

const SCOPE_CACHE_KEY = Symbol("qualityHseScope");

/**
 * Resolve the caller's quality/HSE project scope. Cached on the request so
 * multi-step handlers don't pay the lookup twice. Returns an empty scope
 * (zero accessible projects) when no user is attached — the caller is
 * expected to be behind requireAuth.
 */
export async function getQualityHseScope(req: Request): Promise<ProjectScope> {
  const cached = (req as unknown as Record<symbol, ProjectScope | undefined>)[SCOPE_CACHE_KEY];
  if (cached) return cached;

  const user = getEffectiveUser(req);
  if (!user) {
    const empty: ProjectScope = {
      kind: "scoped",
      projectIds: new Set<number>(),
      projectNames: new Set<string>(),
    };
    (req as unknown as Record<symbol, ProjectScope>)[SCOPE_CACHE_KEY] = empty;
    return empty;
  }

  const role = normalizeRoleForPermissions(user.role || "");
  if (QUALITY_HSE_OVERSIGHT_ROLES.has(role)) {
    const oversight: ProjectScope = { kind: "full_oversight" };
    (req as unknown as Record<symbol, ProjectScope>)[SCOPE_CACHE_KEY] = oversight;
    return oversight;
  }

  // resolveProjectScope() does its own FULL_OVERSIGHT_ROLES short-circuit,
  // but every role still here is by construction excluded from that set, so
  // it always runs the 3-query per-user lookup.
  const scope = await resolveProjectScope(user.id, role, user.name || "");
  (req as unknown as Record<symbol, ProjectScope>)[SCOPE_CACHE_KEY] = scope;
  return scope;
}

export function scopeAllowsProject(scope: ProjectScope, projectId: number): boolean {
  return isProjectAccessible(scope, projectId);
}

export function scopeAllowsProjectName(scope: ProjectScope, projectName: string): boolean {
  return isProjectAccessibleByName(scope, projectName);
}

/** Snapshot helper for `inArray(...)` filters; null = no scoping needed. */
export function scopedProjectIdsArray(scope: ProjectScope): number[] | null {
  if (scope.kind === "full_oversight") return null;
  return [...scope.projectIds];
}

/** Snapshot helper for projectName-based tables. */
export function scopedProjectNamesArray(scope: ProjectScope): string[] | null {
  if (scope.kind === "full_oversight") return null;
  return [...scope.projectNames];
}
