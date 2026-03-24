import type { NextFunction, Request, Response } from 'express';
import { requireAuth as baseRequireAuth } from '../auth-context';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return baseRequireAuth(req, res, next);
}
