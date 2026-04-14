import type { NextFunction, Request, Response } from "express";

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function blockInProduction(reason: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (isProductionRuntime()) {
      return res.status(403).json({
        error: "blocked_in_production",
        message: reason,
      });
    }
    return next();
  };
}

export function requireDangerousActionConfirmation(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = typeof req.body?.confirm === "string" ? req.body.confirm : "";
    if (provided !== expected) {
      return res.status(400).json({
        error: "confirmation_required",
        message: `Must send confirm: "${expected}"`,
      });
    }
    return next();
  };
}
