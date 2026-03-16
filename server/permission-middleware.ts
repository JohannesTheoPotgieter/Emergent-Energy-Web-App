import { Request, Response, NextFunction } from "express";
import { ENTITY_PERMISSION_DEFAULTS, normalizeRoleForPermissions, rolePermissions, type PermissionEntity, type PermissionAction } from "@shared/schema";
import { verifyToken } from "./jwt";
import { db } from "./db";
import { eq } from "drizzle-orm";

let entityPermCache: Record<string, Record<string, Record<string, boolean>>> = {};
let cacheLoadedAt = 0;
const CACHE_TTL = 60_000;

async function loadEntityPermissions() {
  const now = Date.now();
  if (now - cacheLoadedAt < CACHE_TTL && Object.keys(entityPermCache).length > 0) return;
  try {
    const rows = await db.select({ role: rolePermissions.role, entityPermissions: rolePermissions.entityPermissions }).from(rolePermissions);
    const cache: typeof entityPermCache = {};
    for (const row of rows) {
      if (row.entityPermissions && typeof row.entityPermissions === 'object') {
        cache[row.role] = row.entityPermissions as Record<string, Record<string, boolean>>;
      }
    }
    entityPermCache = cache;
    cacheLoadedAt = now;
  } catch {
    // Fall back to defaults on DB error
  }
}

export function invalidateEntityPermCache() {
  cacheLoadedAt = 0;
}

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

  return normalizeRoleForPermissions(role);
}

export function requirePermission(entity: PermissionEntity, action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = resolveUserRole(req);
    if (!role) {
      return res.status(401).json({ error: "auth_required", message: "Authentication required" });
    }

    await loadEntityPermissions();

    const dbPerms = entityPermCache[role];
    if (dbPerms && dbPerms[entity]) {
      if (dbPerms[entity][action] === true) return next();
      if (dbPerms[entity][action] === false) {
        return res.status(403).json({ error: "forbidden", entity, action });
      }
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
