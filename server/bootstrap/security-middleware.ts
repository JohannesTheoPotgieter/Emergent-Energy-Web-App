import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import path from "path";
import { verifyToken } from "../jwt";
import { getRedisClient, isRedisCache } from "../lib/cache";

type RateLimitEntry = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

const authLimiterStore = new Map<string, RateLimitEntry>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_WINDOW_SECONDS = Math.ceil(AUTH_WINDOW_MS / 1000);
const AUTH_MAX_REQUESTS = 20;
const AUTH_STORE_TTL_MS = 60 * 60 * 1000;

const AUTH_ENDPOINTS = new Set([
  "/api/auth/login",
  "/api/auth/microsoft",
  "/api/auth/microsoft/callback",
]);

// General API rate limiting (less strict than auth).
//
// Keyed per-user when a session/JWT identifies them, otherwise per-IP. Project
// detail pages can fan out 10–15 concurrent queries on first paint; on shared
// egress (corporate NAT, Replit proxy) a 200/min IP cap was being exhausted by
// a single user navigating a few pages. 600/min is comfortably above observed
// p99 burst (~80) while still blocking abusive clients.
const API_WINDOW_MS = 60 * 1000; // 1 minute
const API_MAX_REQUESTS = 600;
const apiLimiterStore = new Map<string, RateLimitEntry>();

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

/**
 * The auth rate limiter (20 req / 15 min / IP+path) is protecting a
 * prod login endpoint from brute force. In non-production runs,
 * localhost/CI loopback is exempt: the test suite hammers /api/auth/login
 * from 127.0.0.1 far faster than a human ever could, and any bypass from
 * the real internet requires forging x-forwarded-for against a server
 * that's by definition not exposed. Gate strictly on NODE_ENV so the
 * exemption never leaks to prod. See Phase 4 long-term fix.
 */
function isNonProdLoopback(req: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : req.ip;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function cleanupAuthLimiter(now: number): void {
  for (const [key, value] of authLimiterStore.entries()) {
    if (value.resetAt <= now || now - value.lastSeenAt > AUTH_STORE_TTL_MS) {
      authLimiterStore.delete(key);
    }
  }
}

// ─── Redis-backed rate limiting ─────────────────────────────────────

async function redisRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!AUTH_ENDPOINTS.has(req.path)) {
    next();
    return;
  }

  if (isNonProdLoopback(req)) {
    next();
    return;
  }

  const redis = getRedisClient();
  if (!redis) {
    // Redis disappeared — fall back to in-memory
    memoryRateLimit(req, res, next);
    return;
  }

  const key = `ratelimit:auth:${getClientKey(req)}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First request in window — set the expiry
      await redis.expire(key, AUTH_WINDOW_SECONDS);
    }

    if (count > AUTH_MAX_REQUESTS) {
      res.status(429).json({ message: "Too many authentication attempts. Please retry later." });
      return;
    }

    next();
  } catch {
    // Redis error — fall back to in-memory check
    memoryRateLimit(req, res, next);
  }
}

// ─── In-memory rate limiting (fallback) ─────────────────────────────

function memoryRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENDPOINTS.has(req.path)) {
    next();
    return;
  }

  if (isNonProdLoopback(req)) {
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

function generalApiRateLimit(req: Request, res: Response, next: NextFunction): void {
  // Only rate-limit API endpoints, not static assets
  if (!req.path.startsWith("/api/") || AUTH_ENDPOINTS.has(req.path)) {
    next();
    return;
  }

  // Prefer the bearer-token identity over IP so multiple users behind one
  // egress IP (corporate NAT, Replit proxy) don't share a budget. We do a
  // fast JWT verify here — the auth middleware that decorates req.user runs
  // *after* this rate-limit gate, so we can't read req.user. Falls back to
  // IP for unauthenticated traffic, where brute-force protection matters.
  const authHeader = req.headers.authorization;
  let userId: string | null = null;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const decoded = verifyToken(authHeader.slice(7));
    if (decoded?.userId != null) userId = String(decoded.userId);
  }
  const ip = typeof req.headers["x-forwarded-for"] === "string"
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.ip;
  const key = userId !== null ? `api:user:${userId}` : `api:ip:${ip}`;
  const now = Date.now();

  if (apiLimiterStore.size > 10000) {
    for (const [k, v] of apiLimiterStore.entries()) {
      if (v.resetAt <= now) apiLimiterStore.delete(k);
    }
  }

  const current = apiLimiterStore.get(key);
  if (!current || current.resetAt <= now) {
    apiLimiterStore.set(key, { count: 1, resetAt: now + API_WINDOW_MS, lastSeenAt: now });
    next();
    return;
  }

  if (current.count >= API_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Limit", String(API_MAX_REQUESTS));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
    res.status(429).json({ message: "Too many requests. Please slow down.", retryAfter: retryAfterSec });
    return;
  }

  current.count += 1;
  current.lastSeenAt = now;
  res.setHeader("X-RateLimit-Limit", String(API_MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(API_MAX_REQUESTS - current.count));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
  next();
}

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isRedisCache()) {
    // Use Redis-backed rate limiter — handles its own fallback on error
    redisRateLimit(req, res, next).catch(() => memoryRateLimit(req, res, next));
  } else {
    memoryRateLimit(req, res, next);
  }
}

export function applySecurityAndParsingMiddleware(app: Express): void {
  const isReplit = !!(process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || process.env.REPL_ID);
  const isProduction = process.env.NODE_ENV === "production";

  // Helmet provides secure defaults for many HTTP headers including CSP.
  //
  // font-src policy — long-term:
  //   The app bundles Inter / Barlow / JetBrains Mono via @fontsource (woff2
  //   files emitted to /assets/* — same-origin, covered by 'self'). Tailwind
  //   v4 + the Replit dev banner can also pull fonts from gstatic and
  //   occasionally inline them as data: URIs. Fonts are an extremely low
  //   exfiltration vector vs. scripts, so we allow `https:` to absorb any
  //   third-party font URL injected by tooling without producing a
  //   user-visible CSP violation. Scripts and connect-src remain enumerated.
  const cspDirectives: Record<string, string[]> = isProduction
    ? {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      }
    : {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      };

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: cspDirectives,
      },
      // Let our manual middleware below handle frame options for Replit compatibility
      frameguard: false,
      // Helmet sets these by default, but we keep explicit control below
      referrerPolicy: false,
    }),
  );

  // Manual headers that need environment-specific logic or that helmet doesn't cover
  app.use((_req, res, next) => {
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
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!verifyToken(authHeader.substring(7))) {
        return res.status(401).json({ error: "Invalid auth token" });
      }
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
  app.use(generalApiRateLimit);
}
