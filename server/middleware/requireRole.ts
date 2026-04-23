import type { NextFunction, Request, Response } from "express";
import { normalizeRoleForPermissions } from "@shared/schema";
import { getEffectiveUser } from "../auth-context";

export function requireRole(allowedRoles: string[]) {
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRoleForPermissions(role));

  return (req: Request, res: Response, next: NextFunction) => {
    const user = getEffectiveUser(req);

    if (!req.isAuthenticated?.() || !user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const normalizedUserRole = normalizeRoleForPermissions(user.role);
    if (!normalizedUserRole || !normalizedAllowedRoles.includes(normalizedUserRole)) {
      return res.status(403).json({ error: "Insufficient role" });
    }

    return next();
  };
}
