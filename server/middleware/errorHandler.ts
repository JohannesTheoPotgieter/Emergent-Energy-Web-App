import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, logApiError, sendError } from '../lib/api-error';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  const traceId = randomUUID();
  logApiError(`${req.method} ${req.path} [traceId=${traceId}]`, err);

  if (err instanceof ApiError) {
    return sendError(res, err, traceId);
  }

  if (err instanceof ZodError || err.name === 'ZodError') {
    const zodErr = err as ZodError;
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      code: 'VALIDATION_ERROR',
      type: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: zodErr.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      traceId,
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      code: 'UNAUTHORIZED',
      type: 'UNAUTHORIZED',
      message: 'Authentication required',
      traceId,
    });
  }

  return sendError(res, err, traceId);
}
