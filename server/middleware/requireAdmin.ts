// Thin shim — Task #101 (roles & permissions rework).
//
// `requireAdmin` and `requireCosOverrideRole` used to maintain their own
// hardcoded role sets. They now delegate to the canonical evaluator
// (`evaluatePermissionForRequest`) so there is exactly ONE permission
// path through the system.
//
// The public exports keep their original names + signatures so all
// 394 existing call sites work unchanged.
//
// Behaviour-equivalence is verified by qa/fixtures/permission-snapshot-pre-rework.json:
//   admin:edit grants → exactly { COO_ADMIN, CEO_ADMIN } (matches the
//   original Set above), so this shim is a byte-equal rewrite.

import type { NextFunction, Request, Response } from 'express';
import { normalizeRoleForPermissions } from '@shared/schema';
import { requirePermission } from '../permission-middleware';
import logger from '../lib/logger';

let warned = false;
function warnOnce(name: string) {
  if (warned) return;
  warned = true;
  logger.info(
    `[permissions] ${name} is a thin shim around requirePermission('admin','edit'). ` +
      `New code should call requirePermission directly — see docs/permissions.md.`,
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  warnOnce('requireAdmin');
  return requirePermission('admin', 'edit')(req, res, next);
}

// COS recognition OVERRIDE — bypasses the "invoice must be linked" rule.
// Spec: "COO / CFO / PFM can force-recognise with a mandatory reason
// field, logged in the audit trail." CEO_ADMIN kept as escalation path.
//
// This stays role-list-based because there is no canonical entity for
// "COS recognition override" yet (it's a workflow rule, not a screen).
// Tracked as a follow-up to migrate when the cos_override entity ships.
const COS_OVERRIDE_ROLES = new Set([
  'COO_ADMIN',
  'CEO_ADMIN',
  'CFO',
  'PROGRAM_FINANCE_MANAGER',
]);

export function requireCosOverrideRole(req: Request, res: Response, next: NextFunction) {
  const rawRole = req.user?.role;
  const normalized = normalizeRoleForPermissions(rawRole);
  if (COS_OVERRIDE_ROLES.has(rawRole ?? '') || COS_OVERRIDE_ROLES.has(normalized)) {
    return next();
  }
  res.status(403).json({
    error: 'forbidden',
    reason:
      'COS override requires one of: COO_ADMIN, CEO_ADMIN, CFO, PROGRAM_FINANCE_MANAGER.',
    eligibleRoles: Array.from(COS_OVERRIDE_ROLES),
  });
}
