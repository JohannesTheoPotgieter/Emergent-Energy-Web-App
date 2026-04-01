import type { NextFunction, Request, Response } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[${req.method} ${req.path}]`, err);

  if (res.headersSent) {
    return next(err);
  }

  if (err.name === 'ZodError') {
    const zodErr = err as import('zod').ZodError;
    return res.status(400).json({
      error: 'Validation error',
      details: zodErr.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development'
      ? { details: err.message, stack: err.stack }
      : {}),
  });
}
