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
import { bridgeQueueDepth } from "../../bridge/bridge-writer";

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

/**
 * DF-12 (audit V2) — bridge sync lag. The bridge writes finance state
 * from `normalized_*` to the promoted `core.finance_*` schema in a fire-
 * and-forget pattern (server/bridge/bridge-writer.ts). Failures are
 * persisted to `internal.bridge_sync_failures` for retry pickup. The
 * lag indicator surfaces how many unresolved failures exist and the
 * oldest age so KPI surfaces can warn when the promoted schema is
 * silently behind the canonical one.
 */
export interface BridgeSyncLagSummary {
  unresolvedCount: number;
  oldestUnresolvedAgeMs: number | null;
  oldestUnresolvedAt: string | null;
}

/**
 * TF-12 (audit V3) — in-flight bridge-writer queue depth. Surfaced
 * here so operators can spot a queue building up before it OOMs the
 * process. Counts the live `withRetry()` invocations.
 */
export interface BridgeQueueDepthSummary {
  inflight: number;
  peak: number;
  warnThreshold: number;
}

export interface FinanceSyncHealthReport {
  generatedAt: string;
  overallHealth: "healthy" | "stale" | "failing" | "unknown";
  anyStale: boolean;
  anyFailing: boolean;
  integrations: FinanceSyncHealthIntegration[];
  bridgeSyncLag: BridgeSyncLagSummary;
  bridgeQueueDepth: BridgeQueueDepthSummary;
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

  // DF-12 (audit V2): bridge sync lag indicator. Best-effort — if the
  // table doesn't exist (older environments) we return zero.
  const bridgeSyncLag = await readBridgeSyncLag();

  // TF-12 (audit V3): live bridge queue depth — read direct from the
  // in-memory counter on bridge-writer.
  const bridgeQueueDepthSummary = bridgeQueueDepth();

  return {
    generatedAt: new Date().toISOString(),
    overallHealth,
    anyStale: integrations.some((i) => i.health === "stale"),
    anyFailing: integrations.some((i) => i.health === "failing"),
    integrations,
    bridgeSyncLag,
    bridgeQueueDepth: bridgeQueueDepthSummary,
  };
}

/**
 * Read the bridge-sync-failures table for the unresolved-count + oldest-
 * age summary. Best-effort: any DB error returns a zero summary so the
 * sync-health endpoint stays available.
 */
async function readBridgeSyncLag(): Promise<BridgeSyncLagSummary> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS unresolved_count,
        MIN(created_at) AS oldest_at
      FROM internal.bridge_sync_failures
      WHERE resolved_at IS NULL
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const count = Number(row.unresolved_count ?? 0);
    const oldestRaw = row.oldest_at;
    const oldest = oldestRaw ? new Date(String(oldestRaw)) : null;
    const now = Date.now();
    return {
      unresolvedCount: Number.isFinite(count) ? count : 0,
      oldestUnresolvedAgeMs: oldest ? Math.max(0, now - oldest.getTime()) : null,
      oldestUnresolvedAt: oldest ? oldest.toISOString() : null,
    };
  } catch {
    return {
      unresolvedCount: 0,
      oldestUnresolvedAgeMs: null,
      oldestUnresolvedAt: null,
    };
  }
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
