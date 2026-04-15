/**
 * Finance sync-health aggregator.
 *
 * Wraps the existing `getQuickBooksConnectionStatus()` health signal plus
 * a recent-run summary from `integration_run_events` and exposes it in a
 * finance-centric shape. The reporting surface uses this to show a single
 * "finance sync health" tile instead of forcing users to open the Admin
 * integration health dashboard.
 *
 * Read-only. No mutations. Respects snapshot semantics (no writes to
 * integration_run_events from here).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  getQuickBooksConnectionStatus,
  QB_STALE_AFTER_MS,
} from "../../services/quickbooks-service";

export interface FinanceSyncHealthIntegration {
  name: string;
  displayName: string;
  health: "healthy" | "stale" | "failing" | "unknown";
  connected: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  warning: string | null;
}

export interface FinanceSyncHealthReport {
  generatedAt: string;
  overallHealth: "healthy" | "stale" | "failing" | "unknown";
  anyStale: boolean;
  anyFailing: boolean;
  integrations: FinanceSyncHealthIntegration[];
}

function worstHealth(
  a: FinanceSyncHealthIntegration["health"],
  b: FinanceSyncHealthIntegration["health"],
): FinanceSyncHealthIntegration["health"] {
  const order: Record<FinanceSyncHealthIntegration["health"], number> = {
    failing: 3,
    stale: 2,
    unknown: 1,
    healthy: 0,
  };
  return order[a] >= order[b] ? a : b;
}

/**
 * Build the finance sync-health report. QuickBooks is the only connector
 * that directly gates finance trust today, but the report is an array so
 * future connectors (Xero, banking feeds, SARS e-filing) slot in without a
 * client-side rewrite.
 */
export async function getFinanceSyncHealth(): Promise<FinanceSyncHealthReport> {
  const qbStatus = await getQuickBooksConnectionStatus();

  const qbIntegration: FinanceSyncHealthIntegration = {
    name: "quickbooks",
    displayName: "QuickBooks Online",
    health: qbStatus.health,
    connected: qbStatus.connected,
    lastSuccessAt: qbStatus.lastSuccessfulSyncAt,
    lastFailureAt: qbStatus.lastFailedSyncAt,
    lastFailureReason: qbStatus.lastFailureReason,
    ageMs: qbStatus.ageMs,
    staleAfterMs: qbStatus.staleAfterMs ?? QB_STALE_AFTER_MS,
    warning: qbStatus.isStale
      ? qbStatus.connected
        ? "QuickBooks data has not synced recently — reconciliation figures may be stale."
        : "QuickBooks is not connected — finance reconciliation views are read-only stale data."
      : null,
  };

  const integrations: FinanceSyncHealthIntegration[] = [qbIntegration];

  const overallHealth = integrations.reduce<FinanceSyncHealthIntegration["health"]>(
    (acc, it) => worstHealth(acc, it.health),
    "healthy",
  );

  return {
    generatedAt: new Date().toISOString(),
    overallHealth,
    anyStale: integrations.some((i) => i.health === "stale"),
    anyFailing: integrations.some((i) => i.health === "failing"),
    integrations,
  };
}

/**
 * Count recent finance-touching run events — used by the revalidation
 * endpoint to flag when an ingestion cycle recently completed and monthly
 * reports may need a re-run. Looks back over a caller-supplied window.
 */
export async function countRecentFinanceIngestEvents(withinMs: number): Promise<number> {
  const since = new Date(Date.now() - Math.max(0, withinMs));
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM integration_run_events ire
    JOIN integrations i ON i.id = ire.integration_id
    WHERE i.name IN ('quickbooks')
      AND ire.started_at >= ${since.toISOString()}
      AND ire.status = 'success'
  `);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const n = Number(row.count ?? 0);
  return Number.isFinite(n) ? n : 0;
}
