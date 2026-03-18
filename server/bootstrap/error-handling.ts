import type { Express, NextFunction, Request, Response } from "express";

export function registerGlobalErrorHandler(app: Express): void {
  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    try { require("fs").appendFileSync("/tmp/reassign-debug.log", `${new Date().toISOString()} GLOBAL-ERROR path=${_req.path} method=${_req.method} msg=${err.message}\nstack=${err.stack?.split("\n").slice(0, 5).join("\n")}\n`); } catch {}
    console.error("Internal Server Error:", { path: _req.path, method: _req.method, message: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}
