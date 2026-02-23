import { Request, Response, NextFunction } from "express";
import { ENTITY_PERMISSION_DEFAULTS, type PermissionEntity, type PermissionAction } from "@shared/schema";
import { verifyToken } from "./jwt";

const ROLE_ALIASES: Record<string, string> = { 'admin': 'COO_ADMIN' };

function resolveUserRole(req: Request): string | null {
  let role = (req as any).user?.role || null;
  if (!role && req.isAuthenticated?.() && req.user?.role) role = req.user.role;

  if (!role) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.substring(7));
      if (payload) {
        (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
        role = payload.role;
      }
    }
  }

  if (role && ROLE_ALIASES[role]) {
    role = ROLE_ALIASES[role];
  }

  return role;
}

export function requirePermission(entity: PermissionEntity, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = resolveUserRole(req);
    if (!role) {
      return res.status(401).json({ error: "auth_required", message: "Authentication required" });
    }

    const rule = ENTITY_PERMISSION_DEFAULTS.find(r => r.entity === entity);
    if (!rule) {
      return res.status(403).json({ error: "forbidden", entity, action });
    }

    const actionKey = `${action}_roles` as keyof typeof rule;
    const allowedRoles = rule[actionKey] as string[];

    if (allowedRoles.includes(role)) {
      return next();
    }

    return res.status(403).json({ error: "forbidden", entity, action });
  };
}
