import type { Request } from "express";
import { getEffectiveUser } from "../auth-context";
import { normalizeRoleForPermissions } from "@shared/schema";
import { evaluatePermissionForRequest } from "../permission-middleware";
import { resolveProjectScope, isProjectAccessible } from "../services/project-access-service";

/**
 * Plan-edit authority (owner decision 2026-06-03): a user may edit a
 * project's plan tasks and dependencies when they
 *   (a) hold the `pd_plan:edit` permission, AND
 *   (b) the project is within their project scope — full-oversight roles see
 *       every project; scoped roles (e.g. PROJECT_MANAGER_SITE,
 *       PROJECT_DEVELOPER, ENGINEERING_MANAGER) only the projects they are
 *       assigned to (pm/pd, project_team_members, entity_assignments).
 *
 * This replaces the old hardcoded 3-role list on plan-task edits and the
 * `projects:edit` gate on dependency edits, which locked engineering /
 * construction managers and assigned site PMs out of the very controls the
 * Plan tab shows them (and out of adding the dependencies that drive the
 * critical path / auto-reschedule).
 */
export async function canEditProjectPlan(req: Request, projectId: number): Promise<boolean> {
  const user = getEffectiveUser(req);
  if (!user) return false;
  const perm = await evaluatePermissionForRequest(req, "pd_plan", "edit");
  if (!perm.allowed) return false;
  const role = normalizeRoleForPermissions(user.role || "");
  const scope = await resolveProjectScope(user.id, role, user.name || "");
  return isProjectAccessible(scope, projectId);
}
