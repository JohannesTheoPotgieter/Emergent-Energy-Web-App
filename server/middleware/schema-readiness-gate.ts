/**
 * Finance schema-readiness gate.
 *
 * When the DB is behind on migrations, finance endpoints would otherwise throw
 * raw Drizzle 500s ("relation ... does not exist", "column ... does not
 * exist"). This middleware intercepts the finance surface and returns one
 * typed, correlation-tagged `503 schema_behind` instead — a clear maintenance
 * signal rather than a wall of stack traces.
 *
 * It reads the cached readiness (seeded at boot, refreshed by the health
 * endpoint and the finance schedulers) so it adds no per-request DB query. It
 * fails OPEN: only a positively-determined "behind" state blocks; ready /
 * unknown / unchecked all pass through.
 */

import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/api-error";
import { getCachedSchemaReadiness, isSchemaBehind } from "../lib/schema-readiness";

/**
 * URL prefixes that make up the gated finance surface. `app.use(prefix, …)`
 * matches the prefix and everything beneath it.
 */
export const FINANCE_SCHEMA_GATE_PREFIXES: string[] = [
  "/api/finance",
  "/api/reconciliation",
  "/api/cos-line-review",
  "/api/cashflow-2026",
];

export function financeSchemaReadinessGate(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const readiness = getCachedSchemaReadiness();
  if (!readiness || !isSchemaBehind(readiness)) {
    next();
    return;
  }

  const details: Record<string, string> = {
    pendingCount: String(readiness.pendingMigrations.length),
    pendingMigrations: readiness.pendingMigrations.join(", "),
  };

  // Routed through the global error handler, which attaches a `traceId`
  // (correlation id) and serialises a clean typed body — never a raw DB error.
  next(
    new ApiError(
      503,
      "schema_behind",
      "Finance is temporarily unavailable: the database schema is behind on migrations.",
      details,
      "An operator must apply the pending migrations (`npm run db:migrate` or redeploy), then retry.",
    ),
  );
}
