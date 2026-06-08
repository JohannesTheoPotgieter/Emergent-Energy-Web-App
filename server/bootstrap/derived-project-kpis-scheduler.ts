/**
 * TF-4 (audit V3) — Derived Project KPIs scheduler.
 *
 * Pairs with `server/services/derived-project-kpis-materializer.ts`. Runs
 * a portfolio-wide rebuild on a fixed interval (default 15 minutes) so
 * the priority dashboard / project header tiles / strategic chain view
 * see a fresh cache.
 *
 * Why 15 minutes:
 *   - Most finance writes route through the manual edit endpoints, which
 *     can call `recomputeDerivedKpisForProject(projectId)` directly for
 *     event-driven freshness on that single row.
 *   - Smart Import commits touch many rows at once; the 15-min cron is
 *     the safety net for everything else (QB sync, bridge writes, work-
 *     item edits, schedule changes).
 *   - Shorter (e.g. 1 min) would spam the DB with redundant recomputes;
 *     longer (e.g. 1 h) would leave the cache visibly stale.
 *
 * Resilience:
 *   - Idempotent: each project upserts independently; a failure on one
 *     does not block the rest (the materializer catches per-project).
 *   - Fault-tolerant: an exception in the scheduled function logs and
 *     waits for the next tick instead of crashing the process.
 *   - Catch-up: every tick recomputes every project from scratch. A
 *     missed tick is not consequential — the next run picks up.
 *
 * Startup wiring:
 *   server/bootstrap/startup-orchestrator.ts imports
 *   `scheduleDerivedProjectKpiRefresh()` and calls it after DB init.
 */

import { recomputeAllDerivedKpis } from "../services/derived-project-kpis-materializer";
import { evaluateAppSchemaReadiness } from "./schema-readiness-runtime";
import { formatPendingSummary, isSchemaBehind } from "../lib/schema-readiness";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const JITTER_MS = 30 * 1000; // ±30s jitter for multi-instance deployments

let scheduledInterval: ReturnType<typeof setInterval> | null = null;
let lastRunStartedAt: string | null = null;
let lastRunFinishedAt: string | null = null;
let lastRunProjectCount = 0;
let lastRunErrored = false;
let schemaBehindWarned = false;

async function runOnce(): Promise<void> {
  const startedAt = new Date();
  lastRunStartedAt = startedAt.toISOString();
  lastRunErrored = false;

  // Skip the cycle (with a single warning) when the DB is behind on
  // migrations, rather than throwing a Drizzle error every run.
  const readiness = await evaluateAppSchemaReadiness().catch(() => null);
  if (readiness && isSchemaBehind(readiness)) {
    if (!schemaBehindWarned) {
      console.warn(
        `[derived-project-kpis-scheduler] Skipping refresh — DB schema behind on migrations (${formatPendingSummary(readiness)}). Apply migrations to resume.`,
      );
      schemaBehindWarned = true;
    }
    lastRunFinishedAt = new Date().toISOString();
    return;
  }
  schemaBehindWarned = false;

  try {
    const count = await recomputeAllDerivedKpis();
    lastRunProjectCount = count;
  } catch (err) {
    lastRunErrored = true;
    console.error(
      "[derived-project-kpis-scheduler] unhandled error during refresh:",
      err,
    );
  } finally {
    lastRunFinishedAt = new Date().toISOString();
  }
}

/**
 * Schedule a background refresh of derived_project_kpis for every project.
 * Calls runOnce() at startup (after a small jitter delay) and then every
 * 15 minutes.
 *
 * @param intervalMs  Override the default 15-minute cadence (used by
 *                    tests to fire more often).
 */
export function scheduleDerivedProjectKpiRefresh(intervalMs: number = FIFTEEN_MIN_MS): void {
  if (scheduledInterval) {
    // Already scheduled; do not double-schedule on re-entry.
    return;
  }
  const initialDelay = Math.floor(Math.random() * JITTER_MS);
  setTimeout(() => {
    void runOnce();
    scheduledInterval = setInterval(() => {
      void runOnce();
    }, intervalMs);
  }, initialDelay);
}

/** Cancel the scheduled refresh — used by tests for tear-down. */
export function stopDerivedProjectKpiRefresh(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
  }
}

/**
 * Snapshot of the scheduler's last-run telemetry. Surfaced via the
 * admin health endpoint so operators can verify the cache is refreshing.
 */
export function getDerivedProjectKpiSchedulerStatus(): {
  scheduled: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunProjectCount: number;
  lastRunErrored: boolean;
} {
  return {
    scheduled: scheduledInterval !== null,
    lastRunStartedAt,
    lastRunFinishedAt,
    lastRunProjectCount,
    lastRunErrored,
  };
}
