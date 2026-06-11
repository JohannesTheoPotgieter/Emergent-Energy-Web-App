/**
 * Daily integration credential-expiry sweep.
 *
 * Counts down each connector's lapsing credential (QuickBooks refresh token,
 * Azure / SharePoint client secret) and pages the owner at 30 / 7 / 0 days so
 * a credential never silently lapses during the freeze. Read-only against the
 * third parties — it only reads stored expiry dates and dispatches alerts.
 *
 * Wiring: scheduleCredentialExpirySweep() once at boot from
 * start-runtime-services.ts (Postgres only; skipped in SQLite). Mirrors the
 * idempotent setInterval + jitter + daily-dedupe pattern of the other
 * server/bootstrap/*-scheduler.ts jobs.
 */

import { sweepCredentialExpiries } from "../services/integration-credential-monitor";
import { errMsg } from "../lib/api-error";

const DAILY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 5 * 60 * 1000; // ±5 min so multi-instance deploys don't pile up

let scheduledInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Register the daily credential-expiry sweep. Idempotent — calling twice is a no-op. */
export function scheduleCredentialExpirySweep(): void {
  if (scheduledInterval) return;

  const safeRun = async () => {
    const today = todayUtcDate();
    if (lastRunDate === today) return;
    lastRunDate = today;
    try {
      const summary = await sweepCredentialExpiries();
      if (summary.alertsFired > 0) {
        console.log(
          `[credential-expiry] swept ${summary.checked} connector(s); fired ${summary.alertsFired} expiry alert(s).`,
        );
      }
    } catch (err) {
      console.warn(`[credential-expiry] sweep failed: ${errMsg(err)}`);
    }
  };

  // Fire once at startup (catches up if the server was down across a threshold).
  void safeRun();

  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  scheduledInterval = setInterval(safeRun, DAILY_MS + jitter);
  if (typeof scheduledInterval.unref === "function") scheduledInterval.unref();

  console.log("[credential-expiry] Daily integration credential-expiry sweep registered.");
}

/** Testing hook. */
export function stopCredentialExpirySweepForTests(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
    lastRunDate = null;
  }
}
