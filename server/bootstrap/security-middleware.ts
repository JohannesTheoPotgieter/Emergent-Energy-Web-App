import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "path";

type RateLimitEntry = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

const authLimiterStore = new Map<string, RateLimitEntry>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_REQUESTS = 20;
const AUTH_STORE_TTL_MS = 60 * 60 * 1000;

const AUTH_ENDPOINTS = new Set([
  "/api/auth/login",
  "/api/auth/microsoft",
  "/api/auth/microsoft/callback",
]);

const LARGE_JSON_ROUTES = new Set([
  "/api/project-plan/structure",
  "/api/planning-tasks/bulk",
  "/api/operational-tasks/bulk-update",
  "/api/admin/import/run",
]);

function getClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : req.ip;
  return `${ip}:${req.path}`;
}

function cleanupAuthLimiter(now: number): void {
  for (const [key, value] of authLimiterStore.entries()) {
    if (value.resetAt <= now || now - value.lastSeenAt > AUTH_STORE_TTL_MS) {
      authLimiterStore.delete(key);
    }
  }
}

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENDPOINTS.has(req.path)) {
    next();
    return;
  }

  const key = getClientKey(req);
  const now = Date.now();

  if (authLimiterStore.size > 5000 || now % 50 === 0) {
    cleanupAuthLimiter(now);
  }

  const current = authLimiterStore.get(key);

  if (!current || current.resetAt <= now) {
    authLimiterStore.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS, lastSeenAt: now });
    next();
    return;
  }

  if (current.count >= AUTH_MAX_REQUESTS) {
    res.status(429).json({ message: "Too many authentication attempts. Please retry later." });
    return;
  }

  current.count += 1;
  current.lastSeenAt = now;
  authLimiterStore.set(key, current);
  next();
}

export function applySecurityAndParsingMiddleware(app: Express): void {
  const isReplit = !!(process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || process.env.REPL_ID);
  const isProduction = process.env.NODE_ENV === "production";

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (isReplit || !isProduction) {
      // Allow Replit's iframe preview and cross-origin dev tools
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    } else {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    }

    next();
  });

  const defaultJsonParser = express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody: unknown }).rawBody = buf;
    },
  });

  const largeJsonParser = express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody: unknown }).rawBody = buf;
    },
  });

  app.use((req, res, next) => {
    if (LARGE_JSON_ROUTES.has(req.path)) {
      return largeJsonParser(req, res, next);
    }
    return defaultJsonParser(req, res, next);
  });

  app.use(express.urlencoded({ extended: false, limit: "512kb" }));

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

  app.use(authRateLimit);
}
