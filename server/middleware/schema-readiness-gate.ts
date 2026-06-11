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
import {
  formatDriftSummary,
  getCachedSchemaVerification,
  isSchemaDrifted,
} from "../lib/schema-verification";

/**
 * URL prefixes that make up the gated finance surface. `app.use(prefix, …)`
 * matches the prefix and everything beneath it.
 */
export const FINANCE_SCHEMA_GATE_PREFIXES: string[] = [
  "/api/finance",
  "/api/reconciliation",
  "/api/cos-line-review",
  "/api/weekly-cashflow",
  // Legacy alias prefix — kept so the 308 redirect path is gated identically.
  "/api/cashflow-2026",
];

export function financeSchemaReadinessGate(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Column-level drift: the ledger reports migrations applied but declared
  // tables/columns are missing from the live DB (the 0071 / 0090–0096
  // class). Same maintenance treatment as schema_behind — one typed 503
  // instead of raw Drizzle 500s. Fails OPEN like the readiness check.
  const verification = getCachedSchemaVerification();
  if (verification && isSchemaDrifted(verification)) {
    next(
      new ApiError(
        503,
        "schema_drift",
        "Finance is temporarily unavailable: the live database schema is missing migrated tables/columns.",
        {
          missingTables: verification.missingTables.join(", "),
          missingColumns: verification.missingColumns
            .map((c) => `${c.table}.${c.column}`)
            .join(", "),
          summary: formatDriftSummary(verification),
        },
        "An operator must apply the drift-repair migration (`npm run db:migrate`), confirm with `npm run db:verify-schema`, then retry.",
      ),
    );
    return;
  }

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
