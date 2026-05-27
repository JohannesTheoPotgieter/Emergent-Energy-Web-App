/**
 * TF-15 (audit V3) — Per-user rate limit middleware.
 *
 * Bulk QuickBooks endpoints (find-matches, sync-now, approve-multi) had
 * no rate limit before this. An authenticated user could hammer them
 * and either DOS the upstream QB API or burn the cascade-proposal
 * compute budget. This middleware applies a sliding-window cap per
 * (route, user) pair.
 *
 * Backend: re-uses the existing cache layer (`server/lib/cache.ts`),
 * which is Redis-backed when REDIS_URL is set and in-memory otherwise.
 * Same semantics as the v2 dashboard refresh limiter — safe for the
 * current single-instance deployment; survives restarts when Redis is
 * configured.
 *
 * Usage:
 *
 *   app.post(
 *     "/api/quickbooks/...",
 *     requireAuth,
 *     rateLimitPerUser({ bucket: "qb-find-matches", maxRequests: 10, windowSeconds: 60 }),
 *     handler,
 *   );
 */
import type { NextFunction, Request, Response } from "express";
import { cacheGet, cacheSet } from "../lib/cache";
import { getEffectiveUser } from "../auth-context";

export interface RateLimitOptions {
  /** Short bucket name (e.g. "qb-find-matches"). Combined with userId into the cache key. */
  bucket: string;
  /** Maximum requests per user inside `windowSeconds`. */
  maxRequests: number;
  /** Sliding-window size in seconds. */
  windowSeconds: number;
}

interface BucketState {
  count: number;
  expiresAt: number;
}

export function rateLimitPerUser({
  bucket,
  maxRequests,
  windowSeconds,
}: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = getEffectiveUser(req);
    if (!user) {
      // Auth middleware should have run first. If somehow it didn't, fail open
      // (the auth check will reject the request anyway).
      return next();
    }
    const key = `ratelimit:${bucket}:${user.id}`;
    const nowMs = Date.now();
    const existing = await cacheGet<BucketState>(key);

    if (existing && existing.expiresAt > nowMs) {
      if (existing.count >= maxRequests) {
        const retryAfter = Math.ceil((existing.expiresAt - nowMs) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "rate_limited",
          message: `Too many requests. Try again in ${retryAfter}s.`,
          bucket,
          maxRequests,
          windowSeconds,
        });
        return;
      }
      const updated: BucketState = { count: existing.count + 1, expiresAt: existing.expiresAt };
      const ttlSeconds = Math.max(1, Math.ceil((updated.expiresAt - nowMs) / 1000));
      await cacheSet(key, updated, ttlSeconds);
    } else {
      const fresh: BucketState = {
        count: 1,
        expiresAt: nowMs + windowSeconds * 1000,
      };
      await cacheSet(key, fresh, windowSeconds);
    }
    next();
  };
}
