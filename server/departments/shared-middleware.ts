import type { Request, Response, NextFunction } from "express";
import { getEffectiveUser, requireAuth as sharedRequireAuth } from "../auth-context";
import { requireAdmin, requireCosOverrideRole } from "../middleware/requireAdmin";
import { PRIORITY_ADMIN_ROLES, DEPARTMENT_HEAD_ROLES } from "@shared/config/priorities";
import { checkPermission, type PermissionEntity, type PermissionAction } from "@shared/schema/users";

export { requireAdmin, requireCosOverrideRole };

/**
 * Backend equivalent of the frontend `useAccessMatrix` entity check.
 * Resolves the effective user's role and validates it against
 * ENTITY_PERMISSION_DEFAULTS for the given entity + action. Used to keep
 * UI button visibility and API authorization in lock-step (Task #22).
 */
export function requireEntityPermission(entity: PermissionEntity, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getEffectiveUser(req)?.role;
    if (role && checkPermission(role, entity, action)) {
      return next();
    }
    res.status(403).json({
      error: "forbidden",
      message: `Requires ${entity}:${action} permission`,
      code: "ENTITY_PERMISSION_REQUIRED",
    });
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return sharedRequireAuth(req, res, next);
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getEffectiveUser(req)?.role;
    if (role && roles.includes(role)) {
      return next();
    }
    res.status(403).json({ error: "forbidden", message: `Requires one of: ${roles.join(', ')}`, code: "ROLE_REQUIRED" });
  };
}

export function requirePriorityAdmin(req: Request, res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (role && (PRIORITY_ADMIN_ROLES as readonly string[]).includes(role)) {
    return next();
  }
  res.status(403).json({ error: "forbidden", message: "Priority admin access required", code: "ROLE_REQUIRED" });
}

/**
 * Allow priority admins OR department heads. Used for the POST /api/priorities
 * endpoint so dept heads can create their own department/role-scoped priorities
 * (the route handler enforces scope/department restrictions for non-admins).
 */
export function requirePriorityCreator(req: Request, res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (
    role &&
    ((PRIORITY_ADMIN_ROLES as readonly string[]).includes(role) ||
      (DEPARTMENT_HEAD_ROLES as readonly string[]).includes(role))
  ) {
    return next();
  }
  res.status(403).json({ error: "forbidden", message: "Priority creation requires admin or dept-head role", code: "ROLE_REQUIRED" });
}

export function requireDepartmentHead(req: Request, res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (role && (DEPARTMENT_HEAD_ROLES as readonly string[]).includes(role)) {
    return next();
  }
  res.status(403).json({ error: "forbidden", message: "Department head access required", code: "ROLE_REQUIRED" });
}
