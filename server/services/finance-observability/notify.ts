/**
 * Finance-observability alert sink.
 *
 * One funnel for every observability page so we never build a parallel
 * notification path:
 *   - PRIMARY: the C3 `dispatchAlert` pipeline → COO_ADMIN in-app inbox
 *     (throttled + deduped by the existing notification_throttle). This is
 *     the same reliable channel the #1078 credential-expiry alerts use; it
 *     has no live-token dependency, so it keeps working through the freeze.
 *   - ESCALATION (critical only, best-effort): a Microsoft Teams message via
 *     the EXISTING import-alert channel config on sp_settings. Never throws,
 *     never blocks — if Teams/token is unavailable the inbox alert still lands.
 */

import { dispatchAlert } from "../alert-dispatcher-service";
import { storage } from "../../storage";
import { getSsoTokenForUser } from "../../ms-account-service";
import { sendChannelMessage } from "../../outlook";
import { isConnectorMocked } from "../../lib/connector-mode";

export const FINANCE_OBSERVABILITY_ENTITY = "finance_observability";
const DEFAULT_TARGET = "COO_ADMIN";

export interface FinanceAlertPayload {
  /** Stable event key — drives the notification throttle. */
  eventType: string;
  title: string;
  body: string;
  /** Role to page. Defaults to COO_ADMIN (the owner). */
  alertTarget?: string;
  /** Throttle dedup key — defaults to the finance-observability entity. */
  entityType?: string;
  entityId?: number;
  /** Critical alerts also escalate to the best-effort Teams channel. */
  critical?: boolean;
}

/**
 * Send a finance-observability alert. Returns when the in-app dispatch has been
 * enqueued; the Teams escalation is fired in the background and never blocks.
 */
export async function notifyFinanceOwner(payload: FinanceAlertPayload): Promise<void> {
  await dispatchAlert({
    alertTarget: payload.alertTarget ?? DEFAULT_TARGET,
    eventType: payload.eventType,
    title: payload.title,
    body: payload.body,
    entityType: payload.entityType ?? FINANCE_OBSERVABILITY_ENTITY,
    entityId: payload.entityId ?? 0,
  });

  if (payload.critical) {
    // Best-effort, fully decoupled from the primary alert.
    void maybeSendFinanceTeamsAlert(payload.title, payload.body);
  }
}

/**
 * Best-effort Teams escalation. Reuses the import-alert channel config on
 * sp_settings (alertTeamId / alertChannelId / alertSenderUserId) so there is
 * no new config surface. Off until that channel is configured + enabled.
 */
export async function maybeSendFinanceTeamsAlert(title: string, body: string): Promise<void> {
  try {
    const settings = await storage.getSpSettings();
    if (!settings || !settings.alertsEnabled) return;
    const { alertTeamId, alertChannelId, alertSenderUserId } = settings;
    if (!alertTeamId || !alertChannelId || !alertSenderUserId) return;

    let token: string | null = null;
    if (!isConnectorMocked("ms-graph")) {
      token = await getSsoTokenForUser(alertSenderUserId);
      if (!token) {
        console.warn("[finance-observability] Teams escalation skipped — sender has no Graph token.");
        return;
      }
    }

    const content = `🔴 Finance alert — ${title}\n${body}`;
    await sendChannelMessage(alertTeamId, alertChannelId, content, token);
  } catch (err) {
    console.warn(
      "[finance-observability] Teams escalation failed (non-blocking):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
