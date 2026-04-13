import type { NextFunction, Request, Response } from 'express';
import { normalizeRoleForPermissions } from '@shared/schema';

const ADMIN_ROLES = new Set(['COO_ADMIN', 'CEO_ADMIN']);

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const rawRole = req.user?.role;
  const normalized = normalizeRoleForPermissions(rawRole);
  if (ADMIN_ROLES.has(rawRole ?? '') || ADMIN_ROLES.has(normalized)) {
    return next();
  }
  res.status(403).json({ error: 'admin_required' });
}

// B4 (audit closeout): roles allowed to apply a COS recognition OVERRIDE
// (i.e. bypass the normal "invoice must be linked" rule). Per user spec:
// "COO / CFO / PFM can force-recognise with a mandatory reason field,
// logged in the audit trail." CEO_ADMIN is kept as the ultimate admin
// escalation path.
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
