import type { Request, Response, NextFunction } from "express";
import { getEffectiveUser } from "../auth-context";
import { getEffectiveWorkstreamVisibility } from "../workstream-visibility-middleware";
import { userCanAccessEngineeringTask } from "../repositories/engineering-repository";
import { normalizeRoleForPermissions } from "@shared/schema";
import { forbidden, notFound, badRequest } from "../lib/api-error";

/**
 * Per-row ownership guard for /api/engineering/tasks/:id* routes.
 *
 * `requirePermission("eng_tasks", …)` only answers "may this ROLE touch
 * engineering tasks at all" — it has no notion of WHICH task. Roles whose
 * canonical workstream scope is 'own' (e.g. ENGINEER) must additionally own,
 * or be assigned to, the specific task; otherwise a scoped engineer could read
 * or mutate another engineer's task by iterating the integer id (IDOR). Roles
 * with scope 'all' (managers/admins/PMs) pass through unchanged.
 *
 * Returns 404 (not 403) when a scoped user fails the check so they can't probe
 * which ids exist. Place AFTER requireAuth + requirePermission in the chain.
 * Mirrors the legacy guard in server/engineering-routes.ts on the new surface.
 */
export async function requireEngTaskOwnership(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getEffectiveUser(req);
    if (!user) return next(forbidden());
    const role = normalizeRoleForPermissions(user.role) ?? "";
    const visibility = await getEffectiveWorkstreamVisibility(user.id, role);
    if (visibility.scope !== "own") return next();

    const rawId = req.params.id ?? req.params.taskId;
    const taskId = Number(rawId);
    if (!Number.isInteger(taskId) || taskId <= 0) return next(badRequest("Invalid task id"));

    const allowed = await userCanAccessEngineeringTask(taskId, user.id);
    if (!allowed) return next(notFound("Task"));
    return next();
  } catch (err) {
    return next(err);
  }
}
