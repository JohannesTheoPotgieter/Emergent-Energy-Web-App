/**
 * Daily company-wide tracker-vs-QuickBooks reconciliation refresh.
 *
 * Pulls QuickBooks for the open window, recomputes the invoice-number match,
 * and writes qb_recon_line + qb_recon_summary (snapshot-guarded). Read-only
 * against QuickBooks and the trackers — it COMPARES and flags, never adjusts a
 * tracker (§ 3.4). Best-effort: when QuickBooks is unavailable it writes nothing.
 *
 * Wiring: scheduleQbReconRefresh() once at boot from start-runtime-services.ts
 * (Postgres only; skipped in SQLite). Mirrors qb-payment-refresh-scheduler.
 */

import { db } from "../db";
import { refreshQbTrackerReconciliation } from "../services/qb-tracker-reconcile";
import { recordIntegrationRun } from "../services/integration-health-service";
import { errMsg } from "../lib/api-error";

const INTEGRATION_NAME = "quickbooks-tracker-reconcile";
const DAILY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 5 * 60 * 1000; // ±5 min so multi-instance deploys don't pile up

let scheduledInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runWithAudit(): Promise<void> {
  const startedAt = new Date();
  let status: "success" | "failure" = "success";
  let errorCode: string | null = null;
  let errorDetail: string | null = null;
  let lineRows = 0;
  let summaryRows = 0;
  let qbAvailable = false;

  try {
    const result = await refreshQbTrackerReconciliation(db);
    lineRows = result.lineRows;
    summaryRows = result.summaryRows;
    qbAvailable = result.qbAvailable;
    if (!result.qbAvailable) {
      status = "failure";
      errorCode = "quickbooks_unavailable";
      errorDetail = "QuickBooks unreachable — tracker-vs-QB reconciliation not refreshed this run.";
    }
  } catch (err) {
    status = "failure";
    errorCode = "refresh_failed";
    errorDetail = err instanceof Error ? err.message : String(err);
  } finally {
    await recordIntegrationRun({
      name: INTEGRATION_NAME,
      runType: "nightly_tracker_reconcile",
      startedAt,
      finishedAt: new Date(),
      status,
      recordsProcessed: lineRows,
      errorCode,
      errorDetail,
      metadata: { lineRows, summaryRows, qbAvailable },
    }).catch(() => {
      // Non-fatal — integration health log is best-effort.
    });
  }
}

/** Register the daily refresh scheduler. Idempotent — calling twice is a no-op. */
export function scheduleQbReconRefresh(): void {
  if (scheduledInterval) return;

  const safeRun = async () => {
    const today = todayUtcDate();
    if (lastRunDate === today) return;
    lastRunDate = today;
    await runWithAudit().catch((err) =>
      // runWithAudit already records the failure to integration health; this is
      // a backstop. One concise line — never a full stack every cycle.
      console.warn(`[qb-tracker-reconcile] scheduler cycle failed: ${errMsg(err)}`),
    );
  };

  // Fire once at startup (catches up if the server was down overnight).
  void safeRun();

  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  scheduledInterval = setInterval(safeRun, DAILY_MS + jitter);
  if (typeof scheduledInterval.unref === "function") scheduledInterval.unref();

  console.log("[qb-tracker-reconcile] Daily tracker-vs-QuickBooks reconcile scheduler registered.");
}

/** Testing hook. */
export function stopQbReconRefreshForTests(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
    lastRunDate = null;
  }
}
