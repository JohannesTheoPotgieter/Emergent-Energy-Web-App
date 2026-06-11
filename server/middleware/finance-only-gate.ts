import type { NextFunction, Request, Response } from "express";
import { normalizeRoleForPermissions } from "@shared/schema";
import {
  isFinanceOnlyEnforced,
  isAlwaysAllowedApiPath,
  isRoleAllowedInFinanceModule,
} from "@shared/config/enabled-modules";
import { getEffectiveUser } from "../auth-context";

/**
 * Finance-only module gate (server side).
 *
 * Mounted after the global `jwtAuth` middleware (server/index.ts) so `req.user`
 * is already resolved. When the app is running in finance-only mode, any
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
 * Reversibility: no-op when FINANCE_ONLY_MODE is false.
 */
export function financeOnlyApiGate(req: Request, res: Response, next: NextFunction): void {
  if (!isFinanceOnlyEnforced()) {
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
  if (isRoleAllowedInFinanceModule(role)) {
    next();
    return;
  }

  res.status(403).json({
    error: "forbidden",
    reason: "finance_only_module",
    message: "This area is being updated and is not currently available for your role.",
  });
}
