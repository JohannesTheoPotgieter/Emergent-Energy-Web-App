/**
 * C3 — Integration health alert monitor.
 *
 * Called from recordIntegrationRun after each new run event:
 *   1. Recomputes the current health state for the integration
 *   2. Compares against integrations.last_alert_state (set from the
 *      previous monitor pass)
 *   3. If the transition is alert-worthy per the pure rules in
 *      alert-transition-rules.ts, dispatches an alert payload to the
 *      C3 dispatcher
 *   4. Updates last_alert_state so we don't re-fire on the next run
 *
 * Only health-state transitions trigger alerts — a failing integration
 * that stays failing won't keep paging on every retry.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  integrations,
  integrationRunEvents,
  type Integration,
  type IntegrationHealthState,
  type IntegrationRunEvent,
  type IntegrationRunStatus,
} from "@shared/schema";
import { db } from "../db";
import { deriveIntegrationHealth } from "./integration-health-service";
import { dispatchAlert } from "./alert-dispatcher-service";
import {
  shouldAlertIntegrationTransition,
  type IntegrationAlertReason,
} from "./alert-transition-rules";

function buildAlertCopy(
  reason: NonNullable<IntegrationAlertReason>,
  integration: Integration,
  errorDetail: string | null,
): { eventType: string; title: string; body: string } {
  const display = integration.displayName || integration.name;
  switch (reason) {
    case "now_failing":
      return {
        eventType: "integration_failing",
        title: `Integration failing: ${display}`,
        body: errorDetail
          ? `${display} just transitioned to FAILING. Last error: ${errorDetail}`
          : `${display} just transitioned to FAILING. Check the integration health dashboard.`,
      };
    case "now_stale_from_healthy":
      return {
        eventType: "integration_stale",
        title: `Integration stale: ${display}`,
        body: `${display} has not had a successful run in over 25h and is now marked STALE.`,
      };
    case "recovered_to_healthy":
      return {
        eventType: "integration_recovered",
        title: `Integration recovered: ${display}`,
        body: `${display} is back to HEALTHY after a successful run.`,
      };
  }
}

/**
 * Recompute the current health state for one integration based on its
 * latest run events. Mirrors the per-tile derivation in
 * getIntegrationHealth without the dashboard fan-out.
 */
async function computeCurrentHealth(
  integrationId: number,
): Promise<{
  health: IntegrationHealthState;
  lastError: string | null;
}> {
  const [lastRun] = await db
    .select()
    .from(integrationRunEvents)
    .where(eq(integrationRunEvents.integrationId, integrationId))
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const [lastSuccess] = await db
    .select()
    .from(integrationRunEvents)
    .where(
      and(
        eq(integrationRunEvents.integrationId, integrationId),
        eq(integrationRunEvents.status, "success"),
      ),
    )
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const health = deriveIntegrationHealth({
    lastSuccessAt:
      (lastSuccess as IntegrationRunEvent | undefined)?.startedAt ?? null,
    lastRunAt: (lastRun as IntegrationRunEvent | undefined)?.startedAt ?? null,
    lastRunStatus:
      ((lastRun as IntegrationRunEvent | undefined)?.status as
        | IntegrationRunStatus
        | undefined) ?? null,
  });

  return {
    health,
    lastError: (lastRun as IntegrationRunEvent | undefined)?.errorDetail ?? null,
  };
}

/**
 * Public entry point. Safe to call after every recordIntegrationRun.
 */
export async function checkAndDispatchIntegrationAlert(
  integrationId: number,
): Promise<{
  fired: boolean;
  reason: IntegrationAlertReason;
  current: IntegrationHealthState;
}> {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1);
  if (!integration) {
    return { fired: false, reason: null, current: "unknown" };
  }

  const { health, lastError } = await computeCurrentHealth(integrationId);
  const prev =
    ((integration as Integration).lastAlertState as
      | IntegrationHealthState
      | null
      | undefined) ?? null;

  const reason = shouldAlertIntegrationTransition({ prev, next: health });

  // Persist the new state regardless of whether we fired — this is
  // what stops repeated firing on a sustained failing state.
  if (prev !== health) {
    await db
      .update(integrations)
      .set({ lastAlertState: health, updatedAt: new Date() })
      .where(eq(integrations.id, integrationId));
  }

  if (!reason) {
    return { fired: false, reason: null, current: health };
  }

  const copy = buildAlertCopy(reason, integration as Integration, lastError);
  await dispatchAlert({
    alertTarget: (integration as Integration).alertTarget ?? null,
    eventType: copy.eventType,
    title: copy.title,
    body: copy.body,
    entityType: "integration",
    entityId: integrationId,
  });

  return { fired: true, reason, current: health };
}
