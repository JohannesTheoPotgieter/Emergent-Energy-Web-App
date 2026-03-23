/**
 * Project Scope Middleware — attaches resolved project scope to the request
 * and provides a guard for single-project endpoints.
 *
 * Usage:
 *   app.get("/api/v2/projects", requireAuth, attachProjectScope, handler);
 *   app.get("/api/v2/projects/:projectId", requireAuth, attachProjectScope, requireProjectAccess, handler);
 */

import type { NextFunction, Request, Response } from "express";
import {
  resolveProjectScope,
  isProjectAccessible,
  type ProjectScope,
} from "../services/project-access-service";

// ---------------------------------------------------------------------------
// Symbol for attaching scope to the request (same pattern as auth-context.ts)
// ---------------------------------------------------------------------------

const PROJECT_SCOPE_KEY = Symbol("projectScope");
const HAS_RESOLVED_SCOPE = Symbol("hasResolvedScope");

type RequestWithScope = Request & {
  [PROJECT_SCOPE_KEY]?: ProjectScope;
  [HAS_RESOLVED_SCOPE]?: boolean;
};

// ---------------------------------------------------------------------------
// Middleware: attach scope
// ---------------------------------------------------------------------------

/**
 * Resolves the user's project scope and attaches it to the request.
 * For full-oversight roles this is a no-op (no DB queries).
 * Must run after auth middleware (req.user must be set).
 */
export async function attachProjectScope(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const r = req as RequestWithScope;

  // Avoid double-resolution within the same request
  if (r[HAS_RESOLVED_SCOPE]) return next();

  const user = req.user as any;
  if (!user?.id) {
    // No user — let auth middleware handle rejection
    r[HAS_RESOLVED_SCOPE] = true;
    return next();
  }

  try {
    const scope = await resolveProjectScope(user.id, user.role ?? "", user.name ?? "");
    r[PROJECT_SCOPE_KEY] = scope;
    r[HAS_RESOLVED_SCOPE] = true;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Middleware: guard single-project endpoints
// ---------------------------------------------------------------------------

/**
 * Checks that the current user has access to the project identified by
 * `req.params.projectId`. Returns 403 if not.
 * Must run after `attachProjectScope`.
 */
export function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const scope = getProjectScope(req);

  // Full oversight — always allowed
  if (scope.kind === "full_oversight") return next();

  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) {
    // Let downstream validators handle bad params
    return next();
  }

  if (isProjectAccessible(scope, projectId)) {
    return next();
  }

  res.status(403).json({
    success: false,
    data: null,
    meta: null,
    error: {
      code: "FORBIDDEN",
      message: "You do not have access to this project",
      details: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/**
 * Retrieves the project scope from the request.
 * Returns full_oversight if scope was never attached (safe default for
 * endpoints that don't use the middleware — avoids breaking existing routes).
 */
export function getProjectScope(req: Request): ProjectScope {
  const r = req as RequestWithScope;
  return r[PROJECT_SCOPE_KEY] ?? { kind: "full_oversight" };
}
