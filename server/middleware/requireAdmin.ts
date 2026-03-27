import type { NextFunction, Request, Response } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === 'COO_ADMIN' || role === 'CEO_ADMIN') {
    return next();
  }
  res.status(403).json({ error: 'admin_required' });
}
