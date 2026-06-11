/**
 * Finance error-rate monitor.
 *
 * Tracks finance 5xx responses and finance unhandled exceptions in a rolling
 * in-memory window. The finance watchdog calls `checkErrorRateAndAlert()` each
 * sweep; when the count crosses the threshold the owner is paged once per
 * breach (in-memory transition dedup, so a sustained spike doesn't re-page
 * every sweep). Every error is also written to the structured winston log,
 * which is retained on disk (combined.log / error.log).
 */

import logger from "../../lib/logger";
import {
  resolveErrorRateThresholds,
  isErrorRateBreached,
  type ErrorRateThresholds,
} from "../../lib/finance-observability";
import { notifyFinanceOwner } from "./notify";

/** Route prefixes whose 5xx responses count as finance errors. */
export const FINANCE_PATH_PREFIXES = [
  "/api/finance",
  "/api/weekly-cashflow",
  "/api/cashflow",
  "/api/quickbooks",
  "/api/qb-recon",
  "/api/qb-project-match",
  "/api/reconciliation",
  "/api/cos-tracker",
  "/api/revenue-tracker",
  "/api/gp-tracker",
  "/api/cos-line-review",
  "/api/tracker-replica",
  "/api/excel-vs-app",
  "/api/smart-import",
] as const;

export function isFinancePath(path: string): boolean {
  return FINANCE_PATH_PREFIXES.some((p) => path.startsWith(p));
}

interface ErrorSample {
  at: number;
  route: string;
  status: number;
  kind: "http_5xx" | "exception";
  message: string | null;
}

const MAX_SAMPLES = 500;
let samples: ErrorSample[] = [];
let breachState = false;

function prune(now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  if (samples.length > 0 && samples[0].at < cutoff) {
    samples = samples.filter((s) => s.at >= cutoff);
  }
  if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
}

export interface RecordFinanceErrorParams {
  route: string;
  status: number;
  kind?: "http_5xx" | "exception";
  message?: string | null;
}

/** Record one finance error (5xx response or unhandled exception). */
export function recordFinanceServerError(
  params: RecordFinanceErrorParams,
  now: Date = new Date(),
): void {
  const sample: ErrorSample = {
    at: now.getTime(),
    route: params.route,
    status: params.status,
    kind: params.kind ?? "http_5xx",
    message: params.message ? String(params.message).slice(0, 500) : null,
  };
  samples.push(sample);
  prune(sample.at, resolveErrorRateThresholds().windowMs);

  logger.error("[finance-error]", {
    route: sample.route,
    status: sample.status,
    kind: sample.kind,
    message: sample.message,
    at: new Date(sample.at).toISOString(),
  });
}

export interface FinanceErrorStats {
  windowMs: number;
  threshold: number;
  countInWindow: number;
  breached: boolean;
  recent: Array<{ at: string; route: string; status: number; kind: string }>;
}

export function getFinanceErrorStats(
  now: Date = new Date(),
  thresholds: ErrorRateThresholds = resolveErrorRateThresholds(),
): FinanceErrorStats {
  prune(now.getTime(), thresholds.windowMs);
  const inWindow = samples.filter((s) => s.at >= now.getTime() - thresholds.windowMs);
  return {
    windowMs: thresholds.windowMs,
    threshold: thresholds.countThreshold,
    countInWindow: inWindow.length,
    breached: isErrorRateBreached(inWindow.length, thresholds),
    recent: inWindow
      .slice(-10)
      .map((s) => ({ at: new Date(s.at).toISOString(), route: s.route, status: s.status, kind: s.kind })),
  };
}

export interface ErrorRateAlertResult {
  fired: boolean;
  breached: boolean;
  countInWindow: number;
}

/**
 * Page the owner when the finance error rate crosses the threshold. Fires once
 * per breach (transition false→true); a recovery transition resets the latch so
 * the next breach pages again.
 */
export async function checkErrorRateAndAlert(now: Date = new Date()): Promise<ErrorRateAlertResult> {
  const thresholds = resolveErrorRateThresholds();
  const stats = getFinanceErrorStats(now, thresholds);

  let fired = false;
  if (stats.breached && !breachState) {
    breachState = true;
    fired = true;
    const mins = Math.round(thresholds.windowMs / 60000);
    const routes = [...new Set(stats.recent.map((r) => r.route))].slice(0, 5).join(", ");
    await notifyFinanceOwner({
      eventType: "finance_error_rate_high",
      title: "Finance error rate is high",
      body:
        `${stats.countInWindow} finance server error(s) in the last ${mins} min ` +
        `(threshold ${thresholds.countThreshold}). Recent routes: ${routes || "n/a"}. ` +
        `Check the structured logs (error.log) and the finance pages.`,
      entityId: 1,
      critical: true,
    });
  } else if (!stats.breached && breachState) {
    breachState = false;
  }

  return { fired, breached: stats.breached, countInWindow: stats.countInWindow };
}

/** Test hook — clear the window and latch. */
export function __resetFinanceErrorMonitorForTests(): void {
  samples = [];
  breachState = false;
}
