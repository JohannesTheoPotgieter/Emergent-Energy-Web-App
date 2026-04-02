import type { Request, Response, NextFunction } from "express";
import { getEffectiveUser, requireAuth as sharedRequireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { PRIORITY_ADMIN_ROLES, DEPARTMENT_HEAD_ROLES } from "@shared/config/priorities";

export { requireAdmin };

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

export function requireDepartmentHead(req: Request, res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (role && (DEPARTMENT_HEAD_ROLES as readonly string[]).includes(role)) {
    return next();
  }
  res.status(403).json({ error: "forbidden", message: "Department head access required", code: "ROLE_REQUIRED" });
}
