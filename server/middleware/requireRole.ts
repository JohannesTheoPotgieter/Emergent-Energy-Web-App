// Thin shim — Task #101 (roles & permissions rework).
//
// `requireRole` is now a permanent thin shim that documents itself as
// the LEGACY path; new code should call `requirePermission(entity, action)`.
//
// We deliberately keep the role-list semantics (rather than rerouting
// through the entity evaluator) because requireRole is used in 200+
// places for ad-hoc role gates that don't yet have a corresponding
// entity in the canonical registry. Migrating each one needs a
// per-route decision; the shim just centralises the warning so future
// developers find the canonical alternative.

import type { NextFunction, Request, Response } from "express";
import { normalizeRoleForPermissions } from "@shared/schema";
import { getEffectiveUser } from "../auth-context";

const warned = new Set<string>();
function warnOnce(roleSig: string) {
  if (warned.has(roleSig)) return;
  warned.add(roleSig);
  console.log(
    `[permissions] requireRole([${roleSig}]) is a legacy gate. ` +
      `Prefer requirePermission(entity, action) — see docs/permissions.md.`,
  );
}

export function requireRole(allowedRoles: string[]) {
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRoleForPermissions(role));
  const sig = normalizedAllowedRoles.join(",");
  warnOnce(sig);

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
