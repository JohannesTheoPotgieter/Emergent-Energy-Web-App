/**
 * Finance watchdog scheduler.
 *
 * The active half of the freeze monitoring: every ~30 minutes it runs the
 * dead-man's-switch heartbeat sweep (R1), the data-freshness/drift sweep (R3)
 * and the error-rate check (R2), paging the owner on any transition. This is
 * what catches a job that silently DIED — the reactive integration-run alerts
 * can't, because a dead job records nothing.
 *
 * Postgres-only (wired from start-runtime-services). Mirrors the idempotent
 * setInterval + jitter + unref pattern of the other bootstrap schedulers.
 */

import { registerFinanceJobHeartbeats, sweepFinanceJobHeartbeats } from "../services/finance-observability/job-heartbeats";
import { sweepFinanceFreshness } from "../services/finance-observability/freshness";
import { checkErrorRateAndAlert } from "../services/finance-observability/error-monitor";
import { errMsg } from "../lib/api-error";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const JITTER_MS = 60 * 1000;

let scheduledInterval: ReturnType<typeof setInterval> | null = null;

function resolveIntervalMs(): number {
  const raw = process.env.FINANCE_WATCHDOG_INTERVAL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

async function runSweep(): Promise<void> {
  // Each sweep is independent and best-effort — one failing must not block the
  // others, and a fault must never crash the process.
  try {
    const r = await sweepFinanceJobHeartbeats();
    if (r.fired > 0) console.log(`[finance-watchdog] heartbeat sweep fired ${r.fired} alert(s).`);
  } catch (err) {
    console.warn(`[finance-watchdog] heartbeat sweep failed: ${errMsg(err)}`);
  }
  try {
    const r = await sweepFinanceFreshness();
    if (r.fired > 0) console.log(`[finance-watchdog] freshness sweep fired ${r.fired} alert(s): ${r.breaches.join(", ")}`);
  } catch (err) {
    console.warn(`[finance-watchdog] freshness sweep failed: ${errMsg(err)}`);
  }
  try {
    const r = await checkErrorRateAndAlert();
    if (r.fired) console.log(`[finance-watchdog] error-rate alert fired (${r.countInWindow} in window).`);
  } catch (err) {
    console.warn(`[finance-watchdog] error-rate check failed: ${errMsg(err)}`);
  }
}

/** Register the finance watchdog. Idempotent — calling twice is a no-op. */
export function scheduleFinanceWatchdog(): void {
  if (scheduledInterval) return;

  // Seed heartbeat rows so the dead-man's switch can detect a job that never
  // started (its registration time anchors the staleness window).
  void registerFinanceJobHeartbeats().catch((err) =>
    console.warn(`[finance-watchdog] heartbeat registration failed: ${errMsg(err)}`),
  );

  // First sweep shortly after boot (let schedulers settle), then on the cadence.
  setTimeout(() => void runSweep(), 60 * 1000).unref?.();

  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  scheduledInterval = setInterval(() => void runSweep(), resolveIntervalMs() + jitter);
  if (typeof scheduledInterval.unref === "function") scheduledInterval.unref();

  console.log("[finance-watchdog] Finance watchdog registered (heartbeats + freshness + error-rate).");
}

/** Testing hook. */
export function stopFinanceWatchdogForTests(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
  }
}
