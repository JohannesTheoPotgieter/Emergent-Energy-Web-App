/**
 * Finance health — the single on-demand status the owner checks.
 *
 * Composes the four freeze-hardening dimensions into one payload + an overall
 * level (healthy / warn / critical / unknown):
 *   - jobs        : the dead-man's-switch heartbeats (R1)
 *   - errors      : the finance 5xx / exception rate (R2)
 *   - freshness   : tracker/QB staleness + reconciliation drift (R3)
 *   - integrity   : the latest weekly integrity-guard run (R4)
 *   - integrations: the existing finance sync-health (QB + bridge)
 * plus the recent observability alerts so the page tells the whole story.
 *
 * Read-only. Reuses existing services — no parallel computation.
 */

import { desc, like } from "drizzle-orm";
import { db } from "../../db";
import { notifications } from "@shared/schema";
import {
  worstHealthLevel,
  jobStateToLevel,
  type FinanceHealthLevel,
} from "../../lib/finance-observability";
import { getJobHeartbeatStatuses, type JobHeartbeatStatus } from "./job-heartbeats";
import { getFinanceFreshness, type FinanceFreshnessReport } from "./freshness";
import { getFinanceErrorStats, type FinanceErrorStats } from "./error-monitor";
import { getFinanceSyncHealth, type FinanceSyncHealthReport } from "../../lib/finance-trust/sync-health";
import { financeIntegrityRuns, type FinanceIntegrityRun } from "@shared/schema";

const CRITICAL_FRESHNESS = new Set(["tracker_import_stale", "tracker_vs_qb_variance", "app_vs_tracker_drift"]);

export interface FinanceHealthReport {
  generatedAt: string;
  overall: FinanceHealthLevel;
  components: {
    jobs: FinanceHealthLevel;
    errors: FinanceHealthLevel;
    freshness: FinanceHealthLevel;
    integrity: FinanceHealthLevel;
    integrations: FinanceHealthLevel;
  };
  jobs: JobHeartbeatStatus[];
  errors: FinanceErrorStats;
  freshness: FinanceFreshnessReport;
  integrity: {
    lastRun: FinanceIntegrityRun | null;
    level: FinanceHealthLevel;
  };
  integrations: FinanceSyncHealthReport;
  recentAlerts: Array<{ eventType: string; title: string; body: string | null; at: string }>;
}

function jobsLevel(jobs: JobHeartbeatStatus[]): FinanceHealthLevel {
  return worstHealthLevel(jobs.map((j) => jobStateToLevel(j.state)));
}

function freshnessLevel(report: FinanceFreshnessReport): FinanceHealthLevel {
  const breached = report.signals.filter((s) => s.breached);
  if (breached.length === 0) return "healthy";
  return breached.some((s) => CRITICAL_FRESHNESS.has(s.key)) ? "critical" : "warn";
}

function integrityLevel(run: FinanceIntegrityRun | null): FinanceHealthLevel {
  if (!run) return "unknown";
  switch (run.status) {
    case "drift":
      return "critical";
    case "error":
      return "warn";
    case "skipped":
      return "unknown";
    default:
      return "healthy";
  }
}

function integrationsLevel(report: FinanceSyncHealthReport): FinanceHealthLevel {
  switch (report.overallHealth) {
    case "failing":
      return "critical";
    case "stale":
      return "warn";
    case "unknown":
      return "unknown";
    default:
      return "healthy";
  }
}

async function getLatestIntegrityRun(): Promise<FinanceIntegrityRun | null> {
  const [row] = await db
    .select()
    .from(financeIntegrityRuns)
    .orderBy(desc(financeIntegrityRuns.startedAt))
    .limit(1);
  return (row as FinanceIntegrityRun | undefined) ?? null;
}

async function getRecentFinanceAlerts(): Promise<
  Array<{ eventType: string; title: string; body: string | null; at: string }>
> {
  const rows = await db
    .select({
      eventType: notifications.eventType,
      title: notifications.title,
      body: notifications.body,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(like(notifications.eventType, "finance_%"))
    .orderBy(desc(notifications.createdAt))
    .limit(60);

  // Collapse the per-recipient fan-out into one row per (eventType,title,minute).
  const seen = new Set<string>();
  const out: Array<{ eventType: string; title: string; body: string | null; at: string }> = [];
  for (const r of rows) {
    const at = r.createdAt ? new Date(r.createdAt as unknown as string) : new Date();
    const key = `${r.eventType}|${r.title}|${Math.floor(at.getTime() / 60000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ eventType: r.eventType, title: r.title, body: r.body ?? null, at: at.toISOString() });
    if (out.length >= 20) break;
  }
  return out;
}

/** Build the on-demand finance-health report. */
export async function getFinanceHealth(now: Date = new Date()): Promise<FinanceHealthReport> {
  const [jobs, freshness, errors, integrations, lastIntegrityRun, recentAlerts] = await Promise.all([
    getJobHeartbeatStatuses(now),
    getFinanceFreshness(now),
    Promise.resolve(getFinanceErrorStats(now)),
    getFinanceSyncHealth(),
    getLatestIntegrityRun(),
    getRecentFinanceAlerts(),
  ]);

  const components = {
    jobs: jobsLevel(jobs),
    errors: errors.breached ? ("critical" as FinanceHealthLevel) : ("healthy" as FinanceHealthLevel),
    freshness: freshnessLevel(freshness),
    integrity: integrityLevel(lastIntegrityRun),
    integrations: integrationsLevel(integrations),
  };

  return {
    generatedAt: now.toISOString(),
    overall: worstHealthLevel(Object.values(components)),
    components,
    jobs,
    errors,
    freshness,
    integrity: { lastRun: lastIntegrityRun, level: components.integrity },
    integrations,
    recentAlerts,
  };
}
