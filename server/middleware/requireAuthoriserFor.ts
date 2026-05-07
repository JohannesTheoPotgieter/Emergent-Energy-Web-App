import type { NextFunction, Request, Response } from "express";
import { findEntityRegistry } from "@shared/permissions/registry";
import { normalizeRoleForPermissions } from "@shared/schema";
import type { PermissionEntity } from "@shared/schema/users";
import { getEffectiveUser } from "../auth-context";

/**
 * Required when this middleware grants the request: the route handler reads
 * `req.authoriser` to write the audit-trail row + decorate the response with
 * `override_applied: true`. Audit emission is the handler's job; this
 * middleware only gates.
 */
export interface AuthoriserContext {
  entity: PermissionEntity;
  role: string;
  userId: number;
  reason: string;
}

declare module "express-serve-static-core" {
  interface Request {
    authoriser?: AuthoriserContext;
  }
}

export interface RequireAuthoriserOptions {
  /** Body field that carries the override reason. Default: `override_reason`. */
  reasonField?: string;
}

/**
 * Override-with-reason gate, per AGENT_GUARDRAILS.md § 0A.
 *
 * Reads `ENTITY_REGISTRY[entity].override_roles` from
 * `shared/permissions/registry.ts` — the same canonical authority surface
 * that drives every other RBAC check in the app.
 *
 * Refusal cascade:
 *   - 401 if not authenticated
 *   - 403 if user role not in the entity's override_roles
 *   - 400 if no override reason supplied
 *
 * On success, attaches `req.authoriser = { entity, role, userId, reason }`
 * and calls `next()`. The handler is responsible for writing the audit row
 * and including `override_applied: true` in the response payload.
 */
export function requireAuthoriserFor(
  entity: PermissionEntity,
  opts: RequireAuthoriserOptions = {},
) {
  const reasonField = opts.reasonField ?? "override_reason";
  const registryEntry = findEntityRegistry(entity);
  if (!registryEntry) {
    throw new Error(
      `requireAuthoriserFor: unknown entity '${entity}' (not in ENTITY_REGISTRY)`,
    );
  }
  const allowed = new Set(
    registryEntry.override_roles
      .map((r) => normalizeRoleForPermissions(r))
      .filter((r): r is string => Boolean(r)),
  );
  if (allowed.size === 0) {
    throw new Error(
      `requireAuthoriserFor: entity '${entity}' has no override_roles ` +
        `(or all roles failed normalisation) — every request would 403. ` +
        `Fix shared/permissions/registry.ts before wiring this middleware.`,
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const user = getEffectiveUser(req);
    if (!req.isAuthenticated?.() || !user) {
      res.status(401).json({ error: "auth_required" });
      return;
    }

    const role = normalizeRoleForPermissions(user.role);
    if (!role || !allowed.has(role)) {
      res.status(403).json({
        error: "forbidden",
        entity,
        reason: "role_not_in_override_roles",
      });
      return;
    }

    const rawReason = (req.body ?? {})[reasonField];
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (reason.length === 0) {
      res.status(400).json({
        error: "override_reason_required",
        entity,
        field: reasonField,
      });
      return;
    }

    req.authoriser = { entity, role, userId: user.id, reason };
    next();
  };
}
