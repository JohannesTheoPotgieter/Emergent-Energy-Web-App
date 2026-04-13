/**
 * C3 — Dashboard freshness alert monitor.
 *
 * Called from refreshDashboard after each refresh attempt. Recomputes
 * the freshness state from the snapshot row, compares against
 * dashboard_snapshots.last_alert_state, and dispatches an alert when
 * the transition is alert-worthy per the pure rules in
 * alert-transition-rules.ts.
 *
 * Default alert target for dashboard staleness is COO_ADMIN — the
 * exec who owns the freshness panel. Override via the dashboard
 * definition's alertTarget field (TODO: thread through registry).
 */

import { eq } from "drizzle-orm";
import {
  dashboardSnapshots,
  type DashboardFreshnessState,
  type DashboardSnapshot,
} from "@shared/schema";
import { db } from "../db";
import { dispatchAlert } from "./alert-dispatcher-service";
import {
  shouldAlertDashboardTransition,
  type DashboardAlertReason,
} from "./alert-transition-rules";
import {
  DASHBOARD_DEFAULT_FRESH_MS,
  DASHBOARD_DEFAULT_STALE_MS,
  deriveDashboardFreshness,
} from "./dashboard-refresh-service";

/**
 * Fallback alert target for dashboard staleness — overridable per
 * dashboard definition once we add `alertTarget` to the registry.
 */
export const DASHBOARD_DEFAULT_ALERT_TARGET = "COO_ADMIN";

function buildDashboardCopy(
  reason: NonNullable<DashboardAlertReason>,
  dashboardKey: string,
  errorDetail: string | null,
): { eventType: string; title: string; body: string } {
  switch (reason) {
    case "now_stale":
      return {
        eventType: "dashboard_stale",
        title: `Dashboard stale: ${dashboardKey}`,
        body: errorDetail
          ? `${dashboardKey} has not refreshed successfully in over 4h. Last error: ${errorDetail}`
          : `${dashboardKey} has not refreshed successfully in over 4h. Check the dashboard freshness panel.`,
      };
    case "recovered_to_fresh":
      return {
        eventType: "dashboard_recovered",
        title: `Dashboard recovered: ${dashboardKey}`,
        body: `${dashboardKey} is refreshing successfully again.`,
      };
  }
}

export async function checkAndDispatchDashboardAlert(params: {
  dashboardKey: string;
  scopeKey?: string;
  freshWindowMs?: number;
  staleWindowMs?: number;
  alertTarget?: string | null;
}): Promise<{
  fired: boolean;
  reason: DashboardAlertReason;
  current: DashboardFreshnessState;
}> {
  const [snap] = await db
    .select()
    .from(dashboardSnapshots)
    .where(eq(dashboardSnapshots.dashboardKey, params.dashboardKey))
    .limit(1);
  if (!snap) {
    return { fired: false, reason: null, current: "unknown" };
  }

  const snapshot = snap as DashboardSnapshot;
  const freshWindowMs = params.freshWindowMs ?? DASHBOARD_DEFAULT_FRESH_MS;
  const staleWindowMs = params.staleWindowMs ?? DASHBOARD_DEFAULT_STALE_MS;

  const current = deriveDashboardFreshness({
    lastSuccessAt: snapshot.lastSuccessAt,
    freshWindowMs,
    staleWindowMs,
  });

  const prev =
    (snapshot.lastAlertState as DashboardFreshnessState | null | undefined) ??
    null;

  const reason = shouldAlertDashboardTransition({ prev, next: current });

  if (prev !== current) {
    await db
      .update(dashboardSnapshots)
      .set({ lastAlertState: current, updatedAt: new Date() })
      .where(eq(dashboardSnapshots.id, snapshot.id));
  }

  if (!reason) {
    return { fired: false, reason: null, current };
  }

  const copy = buildDashboardCopy(reason, params.dashboardKey, snapshot.errorDetail);
  await dispatchAlert({
    alertTarget: params.alertTarget ?? DASHBOARD_DEFAULT_ALERT_TARGET,
    eventType: copy.eventType,
    title: copy.title,
    body: copy.body,
    entityType: "dashboard_snapshot",
    entityId: snapshot.id,
  });

  return { fired: true, reason, current };
}
