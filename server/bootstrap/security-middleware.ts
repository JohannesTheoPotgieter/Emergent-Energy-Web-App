import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "path";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const authLimiterStore = new Map<string, RateLimitEntry>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_REQUESTS = 120;

function getClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : req.ip;
  return `${ip}:${req.path}`;
}

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = getClientKey(req);
  const now = Date.now();
  const current = authLimiterStore.get(key);

  if (!current || current.resetAt <= now) {
    authLimiterStore.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    next();
    return;
  }

  if (current.count >= AUTH_MAX_REQUESTS) {
    res.status(429).json({ message: "Too many authentication attempts. Please retry later." });
    return;
  }

  current.count += 1;
  authLimiterStore.set(key, current);
  next();
}

export function applySecurityAndParsingMiddleware(app: Express): void {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use(
    express.json({
      limit: "100mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody: unknown }).rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.use(
    "/uploads",
    (req, res, next) => {
      if (req.path.includes("_private_")) {
        return res.status(403).json({ error: "Access denied" });
      }
      next();
    },
    express.static(path.join(process.cwd(), "uploads")),
  );

  app.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({
        error: "Invalid request format",
        message: "The request data could not be read. Please check the data and try again.",
      });
    }
    next(err);
  });

  app.use(["/api/login", "/api/auth"], authRateLimit);
}
