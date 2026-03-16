import type { Request, Response, NextFunction } from "express";
import { getEffectiveUser, requireAuth as sharedRequireAuth } from "../auth-context";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return sharedRequireAuth(req, res, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "admin_required", message: "Admin access required", code: "ADMIN_REQUIRED" });
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
  const adminRoles = ['admin', 'COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER'];
  if (role && adminRoles.includes(role)) {
    return next();
  }
  res.status(403).json({ error: "forbidden", message: "Priority admin access required", code: "ROLE_REQUIRED" });
}
