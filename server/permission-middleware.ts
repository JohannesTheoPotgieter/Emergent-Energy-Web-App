import { Request, Response, NextFunction } from "express";
import { normalizeRoleForPermissions, rolePermissions, type PermissionEntity, type PermissionAction, type AuthorityAction } from "@shared/schema";
import { evaluateAuthorityForRole, evaluatePermissionForRole } from "@shared/permission-resolver";
import { getEffectiveUser } from "./auth-context";
import { db } from "./db";
import { logAuditFromReq } from "./audit-logger";

let entityPermCache: Record<string, Record<string, Record<string, boolean>>> = {};
type CachedRoleRecord = {
  entityPermissions: unknown;
  authorityModel: unknown;
  canManageUsers: boolean;
  canManageRoles: boolean;
};

let roleRecordCache: Record<string, CachedRoleRecord> = {};
let cacheLoadedAt = 0;
const CACHE_TTL = 60_000;

async function loadEntityPermissions() {
  const now = Date.now();
  if (now - cacheLoadedAt < CACHE_TTL && Object.keys(entityPermCache).length > 0) return;
  try {
    const rows = await db.select({
      role: rolePermissions.role,
      entityPermissions: rolePermissions.entityPermissions,
      authorityModel: rolePermissions.authorityModel,
      canManageUsers: rolePermissions.canManageUsers,
      canManageRoles: rolePermissions.canManageRoles,
    }).from(rolePermissions);
    const cache: typeof entityPermCache = {};
    const roleCache: typeof roleRecordCache = {};
    for (const row of rows) {
      roleCache[row.role] = {
        entityPermissions: row.entityPermissions,
        authorityModel: row.authorityModel,
        canManageUsers: row.canManageUsers,
        canManageRoles: row.canManageRoles,
      };
      if (row.entityPermissions && typeof row.entityPermissions === 'object') {
        cache[row.role] = row.entityPermissions as Record<string, Record<string, boolean>>;
      }
    }
    entityPermCache = cache;
    roleRecordCache = roleCache;
    cacheLoadedAt = now;
  } catch {
    // Fall back to defaults on DB error
  }
}

export function invalidateEntityPermCache() {
  cacheLoadedAt = 0;
}

function resolveUserRole(req: Request): string | null {
  return normalizeRoleForPermissions(getEffectiveUser(req)?.role || null);
}

function buildRoleRecord(role: string) {
  return roleRecordCache[role] || { entityPermissions: entityPermCache[role] as any, authorityModel: null, canManageUsers: false, canManageRoles: false };
}

function logPermissionFailure(req: Request, entity: PermissionEntity, action: string, reason: string) {
  logAuditFromReq(req, {
    entityType: "permission",
    entityId: `${entity}:${action}`,
    action: "permission_denied",
    changesJson: {
      entity,
      action,
      reason,
      role: resolveUserRole(req),
    },
  });
}

export async function evaluateAuthorityForRequest(req: Request, entity: PermissionEntity, action: AuthorityAction) {
  await loadEntityPermissions();
  const role = resolveUserRole(req);
  if (!role) {
    return {
      allowed: false,
      reason: "Authentication required",
      scope: "own",
      source: "none",
      constraints: { fieldRestrictions: [], approvalThresholds: [], delegatedAuthority: [], assignmentRules: [] },
      action,
    } as const;
  }

  return evaluateAuthorityForRole({
    role,
    entity,
    action,
    roleRecord: buildRoleRecord(role) as any,
  });
}

export async function evaluatePermissionForRequest(req: Request, entity: PermissionEntity, action: PermissionAction) {
  await loadEntityPermissions();
  const role = resolveUserRole(req);
  if (!role) {
    return {
      allowed: false,
      reason: "Authentication required",
      source: "none",
    } as const;
  }

  return evaluatePermissionForRole({
    role,
    entity,
    action,
    roleRecord: buildRoleRecord(role) as any,
  });
}

export function requirePermission(entity: PermissionEntity, action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!resolveUserRole(req)) {
      return res.status(401).json({ error: "auth_required", message: "Authentication required" });
    }
    const evalResult = await evaluatePermissionForRequest(req, entity, action);

    if (evalResult.allowed) {
      return next();
    }

    logPermissionFailure(req, entity, action, evalResult.reason);
    return res.status(403).json({ error: "forbidden", entity, action, reason: evalResult.reason });
  };
}

export function requireAuthority(entity: PermissionEntity, action: AuthorityAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = resolveUserRole(req);
    if (!role) {
      return res.status(401).json({ error: "auth_required", message: "Authentication required" });
    }

    const evalResult = await evaluateAuthorityForRequest(req, entity, action);
    if (evalResult.allowed) {
      return next();
    }

    logPermissionFailure(req, entity, action, evalResult.reason);
    return res.status(403).json({ error: "forbidden", entity, action, reason: evalResult.reason, scope: evalResult.scope });
  };
}
