/**
 * C3 — Pure transition-detection rules.
 *
 * These functions decide whether a state change between two snapshots
 * deserves an alert. Pure functions so the unit tests can exhaustively
 * pin the behaviour without touching the DB or the queue.
 */

import type { IntegrationHealthState } from "@shared/schema";
import type { DashboardFreshnessState } from "@shared/schema";

/**
 * Integration health alerting:
 *   - Fire on any transition INTO 'failing' from anything else
 *   - Fire on any transition INTO 'stale' from 'healthy' (sustained
 *     freshness regression — quieter than failing, still worth a ping)
 *   - Fire a single "recovered" alert on transition from
 *     failing/stale -> healthy
 *   - Suppress when prev === next (no state change)
 *   - Suppress everything to/from 'unknown' (boot-up noise)
 */
export type IntegrationAlertReason =
  | "now_failing"
  | "now_stale_from_healthy"
  | "recovered_to_healthy"
  | null;

export function shouldAlertIntegrationTransition(params: {
  prev: IntegrationHealthState | null;
  next: IntegrationHealthState;
}): IntegrationAlertReason {
  const { prev, next } = params;
  if (prev === next) return null;
  if (next === "unknown" || prev === "unknown") return null;

  if (next === "failing") return "now_failing";
  if (next === "stale" && prev === "healthy") return "now_stale_from_healthy";
  if (next === "healthy" && (prev === "failing" || prev === "stale")) {
    return "recovered_to_healthy";
  }
  return null;
}

/**
 * Dashboard freshness alerting:
 *   - Fire on transition INTO 'stale' from anything else (4h cutoff
 *     means refresh is genuinely broken)
 *   - Suppress 'warn' transitions — they'd trip every refresh failure
 *     in a 2h-4h window and the freshness panel already shows them
 *   - Fire 'recovered_to_fresh' on transition from stale -> fresh
 *   - Suppress unknown transitions
 */
export type DashboardAlertReason =
  | "now_stale"
  | "recovered_to_fresh"
  | null;

export function shouldAlertDashboardTransition(params: {
  prev: DashboardFreshnessState | null;
  next: DashboardFreshnessState;
}): DashboardAlertReason {
  const { prev, next } = params;
  if (prev === next) return null;
  if (next === "unknown" || prev === "unknown") return null;

  if (next === "stale") return "now_stale";
  if (next === "fresh" && prev === "stale") return "recovered_to_fresh";
  return null;
}
