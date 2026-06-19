import type { NextFunction, Request, Response } from "express";
import { normalizeRoleForPermissions } from "@shared/schema";
import {
  isLiveReadyEnforced,
  isAlwaysAllowedApiPath,
  isRoleAllowedInLiveReady,
} from "@shared/config/enabled-modules";
import { getEffectiveUser } from "../auth-context";

/**
 * Live-Ready module gate (server side).
 *
 * Mounted after the global `jwtAuth` middleware (server/index.ts) so `req.user`
 * is already resolved. When the app is running in live-ready mode, any
 * AUTHENTICATED request from a role outside the finance-module allowlist is
 * blocked at the API boundary with 403 — so no non-finance data calls succeed
 * for those users (defence-in-depth behind the client no-access landing).
 *
 * What stays reachable for everyone (so login / logout / the no-access landing
 * keep working): a small set of always-allowed prefixes (auth, version,
 * environment, feature-flags, screen-settings) and any non-`/api` route.
 *
 * Allowed roles fall through to the existing per-route RBAC
 * (`requirePermission`) unchanged. This gate does NOT block module APIs for
 * allowed roles — module reachability for the UI is enforced client-side via
 * the route redirect; admins retain their normal API access. No finance number,
 * formula or schema is touched.
 *
 * Reversibility: no-op when LIVE_READY_MODE is false.
 */
export function liveReadyApiGate(req: Request, res: Response, next: NextFunction): void {
  if (!isLiveReadyEnforced()) {
    next();
    return;
  }

  const path = req.path;
  // Only police the API surface; SPA assets / HTML are served normally.
  if (!path.startsWith("/api")) {
    next();
    return;
  }

  if (isAlwaysAllowedApiPath(path)) {
    next();
    return;
  }

  const user = getEffectiveUser(req);
  // Unauthenticated requests are left to the auth layer (401 where required).
  if (!user) {
    next();
    return;
  }

  const role = normalizeRoleForPermissions(user.role);
  if (isRoleAllowedInLiveReady(role)) {
    next();
    return;
  }

  res.status(403).json({
    error: "forbidden",
    reason: "live_ready_module",
    message: "This area is being updated and is not currently available for your role.",
  });
}
