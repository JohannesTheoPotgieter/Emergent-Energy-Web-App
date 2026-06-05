/**
 * Import alert service — posts a Microsoft Teams message when a scheduled
 * import fails or parks for review.
 *
 * The scheduler runs with no user context, so it borrows a configured
 * sender's stored delegated Graph token (`sp_settings.alert_sender_user_id`)
 * to post to the configured team/channel. All config lives on `sp_settings`
 * and alerting is OFF until a channel + sender are set.
 *
 * Design notes:
 *  - Never throws. Alerting must not break or slow an import — every failure
 *    path is swallowed with a warning.
 *  - Mock-safe: in dev with no Graph creds, `sendChannelMessage` short-circuits
 *    to a mock, so a no-token local run won't error.
 *  - One alert per run outcome (bounded by file count) — not a poll loop.
 */

import { storage } from "../storage";
import { getSsoTokenForUser } from "../ms-account-service";
import { sendChannelMessage } from "../outlook";
import { isConnectorMocked } from "../lib/connector-mode";
import { getRunById } from "../repositories/import-runs-repository";
import { summarizeImportRun, type ImportRunSummaryView } from "../lib/import/run-summary";

export type ImportAlertKind = "failed" | "needs_review";

/**
 * Send a Teams alert for a run that needs a human, if alerting is configured
 * and enabled for this kind. Safe to call unconditionally from the scheduler.
 */
export async function maybeSendImportAlert(
  kind: ImportAlertKind,
  runId: number | null,
): Promise<void> {
  if (!runId) return;
  try {
    const settings = await storage.getSpSettings();
    if (!settings || !settings.alertsEnabled) return;
    if (kind === "failed" && !settings.alertOnFailure) return;
    if (kind === "needs_review" && !settings.alertOnReview) return;

    const { alertTeamId, alertChannelId, alertSenderUserId } = settings;
    if (!alertTeamId || !alertChannelId || !alertSenderUserId) return;

    const run = await getRunById(runId);
    if (!run) return;
    const content = formatAlert(kind, summarizeImportRun(run));

    // In real mode we must have the sender's delegated token to post. In mock
    // mode the send is a no-op stub, so a null token is fine.
    let token: string | null = null;
    if (!isConnectorMocked("ms-graph")) {
      token = await getSsoTokenForUser(alertSenderUserId);
      if (!token) {
        console.warn(`[ImportAlert] sender ${alertSenderUserId} has no Graph token; skipping alert for run ${runId}`);
        return;
      }
    }

    await sendChannelMessage(alertTeamId, alertChannelId, content, token);
    console.log(`[ImportAlert] sent ${kind} alert for run ${runId} to channel ${alertChannelId}`);
  } catch (err) {
    console.warn("[ImportAlert] failed to send (non-blocking):", err instanceof Error ? err.message : String(err));
  }
}

function formatAlert(kind: ImportAlertKind, v: ImportRunSummaryView): string {
  const head = kind === "failed" ? "❌ Import failed" : "⚠️ Import needs review";
  return [
    `${head} — ${v.projectName}`,
    `File: ${v.sourceFileName}`,
    v.reason ? `Reason: ${v.reason}` : null,
    `Open the Smart Import tower to resolve.`,
  ]
    .filter(Boolean)
    .join("\n");
}
