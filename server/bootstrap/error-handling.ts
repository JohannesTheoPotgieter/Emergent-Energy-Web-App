import type { Express, NextFunction, Request, Response } from "express";

export function registerGlobalErrorHandler(app: Express): void {
  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err.message, err.stack?.split("\n").slice(0, 5).join("\n"));

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ error: message, _globalHandler: true, _stack: err.stack?.split("\n").slice(0, 8) });
  });
}
