import type { Express, Request, Response, NextFunction } from "express";

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function applyRequestLogging(app: Express, log: (message: string, source?: string) => void): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const requestId = (req.headers["x-request-id"] as string) || generateRequestId();
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (req.path.startsWith("/api")) {
        log(`${req.method} ${req.path} ${res.statusCode} in ${duration}ms`);
      }
    });

    next();
  });
}
