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
