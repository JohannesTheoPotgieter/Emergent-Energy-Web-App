import type { Express, NextFunction, Request, Response } from "express";

export function registerGlobalErrorHandler(app: Express): void {
  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err.message, err.stack?.split("\n").slice(0, 5).join("\n"));

    if (res.headersSent) {
      return next(err);
    }

    const body: Record<string, any> = { error: message, _globalHandler: true };
    if (process.env.NODE_ENV !== "production") {
      body._stack = err.stack?.split("\n").slice(0, 8);
    }
    return res.status(status).json(body);
  });
}
