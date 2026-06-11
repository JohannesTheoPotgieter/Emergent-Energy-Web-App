/**
 * Finance data-freshness + drift monitor.
 *
 * Computes four freshness/drift signals read-only from canonical snapshots
 * (snapshot-guarded, § 3.1) and pages the owner when any crosses its threshold:
 *   - tracker_import_stale     — no tracker import in N days
 *   - qb_recon_stale           — tracker-vs-QB reconciliation snapshot is old
 *   - tracker_vs_qb_variance   — matched-invoice tracker-vs-QB variance too high
 *   - app_vs_tracker_drift     — app-vs-tracker checks drifting (amber/red)
 *
 * The watchdog calls `sweepFinanceFreshness()` each pass. Alerts fire on the
 * not-breached → breached transition (in-memory latch per signal) so a
 * sustained condition doesn't re-page every sweep.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { qbReconSummary, financialReconciliation, financeJobHeartbeats } from "@shared/schema";
import {
  classifyFreshness,
  resolveFreshnessThresholds,
  type FreshnessInput,
  type FreshnessSignal,
  type FreshnessSignalKey,
  type FreshnessThresholds,
} from "../../lib/finance-observability";
import { notifyFinanceOwner } from "./notify";

function ageMs(at: Date | null, now: Date): number | null {
  return at ? Math.max(0, now.getTime() - at.getTime()) : null;
}

function mostRecent(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

async function heartbeatLastSuccess(jobKey: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastSuccessAt: financeJobHeartbeats.lastSuccessAt })
    .from(financeJobHeartbeats)
    .where(eq(financeJobHeartbeats.jobKey, jobKey))
    .limit(1);
  return row?.lastSuccessAt ?? null;
}

export interface FinanceFreshnessReport {
  generatedAt: string;
  signals: FreshnessSignal[];
  thresholds: FreshnessThresholds;
  observations: {
    trackerImportLastSuccessAt: string | null;
    qbReconComputedAt: string | null;
    trackerVsQbVarianceRand: number | null;
    appVsTrackerDriftCount: number | null;
  };
  anyBreached: boolean;
}

/** Read-only freshness snapshot. */
export async function getFinanceFreshness(now: Date = new Date()): Promise<FinanceFreshnessReport> {
  const thresholds = resolveFreshnessThresholds();

  // ── tracker import age: most recent of the heartbeat + sp_settings success ──
  const [trackerHeartbeat, spSettings] = await Promise.all([
    heartbeatLastSuccess("tracker-import"),
    storage.getSpSettings().catch(() => null),
  ]);
  const trackerImportAt = mostRecent(trackerHeartbeat, spSettings?.lastSuccessAt ?? null);

  // ── QB recon age: newest computed_at on the active company summary ──
  const [reconAgeRow] = await db
    .select({ computedAt: sql<string | null>`MAX(${qbReconSummary.computedAt})` })
    .from(qbReconSummary)
    .where(isNull(qbReconSummary.effectiveTo));
  const qbReconComputedAt = reconAgeRow?.computedAt
    ? new Date(reconAgeRow.computedAt)
    : await heartbeatLastSuccess("qb-recon-refresh");

  // ── tracker-vs-QB variance: Σ|variance_total| on matched invoices (month grain) ──
  const [varianceRow] = await db
    .select({ variance: sql<string>`COALESCE(SUM(ABS(${qbReconSummary.varianceTotal})), 0)` })
    .from(qbReconSummary)
    .where(and(eq(qbReconSummary.periodGrain, "month"), isNull(qbReconSummary.effectiveTo)));
  const trackerVsQbVarianceRand = varianceRow ? Number(varianceRow.variance) : null;

  // ── app-vs-tracker drift: count active reconciliation rows that aren't green ──
  const [driftRow] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(financialReconciliation)
    .where(
      and(
        isNull(financialReconciliation.effectiveTo),
        sql`${financialReconciliation.appVsTrackerStatus} IN ('amber','red')`,
      ),
    );
  const appVsTrackerDriftCount = driftRow ? Number(driftRow.n) : null;

  const input: FreshnessInput = {
    trackerImportAgeMs: ageMs(trackerImportAt, now),
    qbReconAgeMs: ageMs(qbReconComputedAt, now),
    trackerVsQbVarianceRand,
    appVsTrackerDriftCount,
  };
  const signals = classifyFreshness(input, thresholds);

  return {
    generatedAt: now.toISOString(),
    signals,
    thresholds,
    observations: {
      trackerImportLastSuccessAt: trackerImportAt ? trackerImportAt.toISOString() : null,
      qbReconComputedAt: qbReconComputedAt ? qbReconComputedAt.toISOString() : null,
      trackerVsQbVarianceRand,
      appVsTrackerDriftCount,
    },
    anyBreached: signals.some((s) => s.breached),
  };
}

// In-memory per-signal latch so a sustained breach pages once, not every sweep.
const breachLatch = new Map<FreshnessSignalKey, boolean>();

const SIGNAL_COPY: Record<FreshnessSignalKey, { eventType: string; title: string; critical: boolean }> = {
  tracker_import_stale: {
    eventType: "finance_freshness_tracker_import_stale",
    title: "No recent tracker import",
    critical: true,
  },
  qb_recon_stale: {
    eventType: "finance_freshness_qb_recon_stale",
    title: "Tracker-vs-QuickBooks reconciliation is stale",
    critical: false,
  },
  tracker_vs_qb_variance: {
    eventType: "finance_freshness_tracker_vs_qb_variance",
    title: "Tracker-vs-QuickBooks variance over threshold",
    critical: true,
  },
  app_vs_tracker_drift: {
    eventType: "finance_freshness_app_vs_tracker_drift",
    title: "App-vs-tracker reconciliation drift",
    critical: true,
  },
};

export interface FreshnessSweepResult {
  fired: number;
  breaches: FreshnessSignalKey[];
}

/** Injectable seams so the sweep is testable without a live DB. */
export interface FreshnessSweepDeps {
  getReport: (now: Date) => Promise<FinanceFreshnessReport>;
  notify: (payload: Parameters<typeof notifyFinanceOwner>[0]) => Promise<void>;
}

const defaultFreshnessSweepDeps: FreshnessSweepDeps = {
  getReport: getFinanceFreshness,
  notify: notifyFinanceOwner,
};

/** Page on each freshness/drift signal that newly crossed its threshold. */
export async function sweepFinanceFreshness(
  now: Date = new Date(),
  deps: FreshnessSweepDeps = defaultFreshnessSweepDeps,
): Promise<FreshnessSweepResult> {
  const report = await deps.getReport(now);
  const result: FreshnessSweepResult = { fired: 0, breaches: [] };

  for (const signal of report.signals) {
    const was = breachLatch.get(signal.key) ?? false;
    breachLatch.set(signal.key, signal.breached);
    if (signal.breached) result.breaches.push(signal.key);
    if (signal.breached && !was) {
      const copy = SIGNAL_COPY[signal.key];
      result.fired += 1;
      await deps.notify({
        eventType: copy.eventType,
        title: copy.title,
        body: signal.detail,
        entityId: 1,
        critical: copy.critical,
      });
    }
  }

  return result;
}

/** Test hook — clear the per-signal latch. */
export function __resetFinanceFreshnessForTests(): void {
  breachLatch.clear();
}
