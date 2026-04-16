/**
 * Unified integration freshness service.
 *
 * Queries all integration freshness sources (Pipedrive, SharePoint,
 * QuickBooks, Microsoft 365) and returns a single report. Consumed by:
 *   - Handover submission (W1/W5: surface stale CRM data)
 *   - Stage gate evidence snapshots (W5: include freshness in audit)
 *   - Finance reporting (extends existing sync-health.ts for QB)
 *   - Integration health dashboard (unified view)
 *
 * This service is READ-ONLY. It does not mutate integration state.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  integrations,
  integrationRunEvents,
  type IntegrationRunStatus,
} from "@shared/schema/integrations";
import { spListConfig } from "@shared/schema/imports";
import {
  computeFreshnessStatus,
  type IntegrationFreshnessStatus,
  type IntegrationName,
  INTEGRATION_FRESHNESS_THRESHOLDS,
} from "@shared/integration-boundaries";

// ===================== TYPES =====================

export interface IntegrationFreshnessReport {
  generatedAt: string;
  overallHealth: "healthy" | "stale" | "failing" | "unknown";
  staleCount: number;
  failingCount: number;
  integrations: IntegrationFreshnessStatus[];
  /** Warnings suitable for display in handover/reporting surfaces. */
  warnings: string[];
}

// ===================== HELPERS =====================

/**
 * Fetch the last successful run for an integration by name from the
 * integration_run_events table.
 */
async function getLastSuccessFromRunEvents(
  integrationName: string,
): Promise<{ lastSuccessAt: Date | null; isFailing: boolean }> {
  const [integration] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.name, integrationName))
    .limit(1);

  if (!integration) {
    return { lastSuccessAt: null, isFailing: false };
  }

  const [lastSuccess] = await db
    .select({ startedAt: integrationRunEvents.startedAt })
    .from(integrationRunEvents)
    .where(
      and(
        eq(integrationRunEvents.integrationId, integration.id),
        eq(integrationRunEvents.status, "success"),
      ),
    )
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const [lastRun] = await db
    .select({
      startedAt: integrationRunEvents.startedAt,
      status: integrationRunEvents.status,
    })
    .from(integrationRunEvents)
    .where(eq(integrationRunEvents.integrationId, integration.id))
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const lastSuccessAt = lastSuccess?.startedAt ?? null;
  const lastRunStatus = lastRun?.status as IntegrationRunStatus | undefined;
  const isFailing =
    lastRunStatus === "failure" &&
    (!lastSuccessAt || (lastRun?.startedAt && lastRun.startedAt >= lastSuccessAt));

  return { lastSuccessAt, isFailing: isFailing ?? false };
}

/**
 * Get SharePoint freshness from sp_list_config.lastPulledAt. SharePoint
 * sync runs are not (yet) logged to integration_run_events, so we
 * consult its own config table.
 */
async function getSharePointFreshness(): Promise<{
  lastSuccessAt: Date | null;
  isFailing: boolean;
}> {
  // Also check integration_run_events if SP sync has been wired there
  const runEvents = await getLastSuccessFromRunEvents("sharepoint");
  if (runEvents.lastSuccessAt) {
    return runEvents;
  }

  // Fallback: read from sp_list_config
  const [config] = await db
    .select({ lastPulledAt: spListConfig.lastPulledAt })
    .from(spListConfig)
    .limit(1);

  return {
    lastSuccessAt: config?.lastPulledAt ?? null,
    isFailing: false,
  };
}

// ===================== MAIN ENTRY POINT =====================

/**
 * Build the unified integration freshness report. Queries all
 * integration freshness sources in parallel.
 */
export async function getIntegrationFreshnessReport(
  now: Date = new Date(),
): Promise<IntegrationFreshnessReport> {
  const [pipedrive, sharepoint, quickbooks, microsoft365] = await Promise.all([
    getLastSuccessFromRunEvents("pipedrive"),
    getSharePointFreshness(),
    getLastSuccessFromRunEvents("quickbooks"),
    getLastSuccessFromRunEvents("microsoft_365"),
  ]);

  const statuses: IntegrationFreshnessStatus[] = [
    computeFreshnessStatus("pipedrive", "Pipedrive CRM", pipedrive.lastSuccessAt, pipedrive.isFailing, now),
    computeFreshnessStatus("sharepoint", "SharePoint Sync", sharepoint.lastSuccessAt, sharepoint.isFailing, now),
    computeFreshnessStatus("quickbooks", "QuickBooks Online", quickbooks.lastSuccessAt, quickbooks.isFailing, now),
    computeFreshnessStatus("microsoft_365", "Microsoft 365", microsoft365.lastSuccessAt, microsoft365.isFailing, now),
  ];

  const staleCount = statuses.filter(s => s.isStale && s.health !== "failing").length;
  const failingCount = statuses.filter(s => s.isFailing).length;
  const warnings = statuses
    .map(s => s.warning)
    .filter((w): w is string => w !== null);

  let overallHealth: IntegrationFreshnessReport["overallHealth"] = "healthy";
  if (failingCount > 0) overallHealth = "failing";
  else if (staleCount > 0) overallHealth = "stale";
  else if (statuses.every(s => s.health === "unknown")) overallHealth = "unknown";

  return {
    generatedAt: now.toISOString(),
    overallHealth,
    staleCount,
    failingCount,
    integrations: statuses,
    warnings,
  };
}

/**
 * Quick check for a single integration's freshness. Used by
 * route-level guards that want to warn on stale data without
 * pulling the full report.
 */
export async function isIntegrationFresh(
  name: IntegrationName,
  now: Date = new Date(),
): Promise<boolean> {
  const threshold = INTEGRATION_FRESHNESS_THRESHOLDS[name];
  let lastSuccessAt: Date | null = null;

  if (name === "sharepoint") {
    const sp = await getSharePointFreshness();
    lastSuccessAt = sp.lastSuccessAt;
  } else {
    const run = await getLastSuccessFromRunEvents(name);
    lastSuccessAt = run.lastSuccessAt;
  }

  if (!lastSuccessAt) return false;
  return (now.getTime() - lastSuccessAt.getTime()) <= threshold;
}
