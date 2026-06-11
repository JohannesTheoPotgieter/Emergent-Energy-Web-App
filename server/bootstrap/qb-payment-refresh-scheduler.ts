/**
 * Nightly QB payment-status refresh job.
 *
 * Walks every active quickbooks_invoice_links row and refreshes
 * qb_balance / qb_payment_status on the corresponding quickbooks_documents
 * snapshot. Throttled to at most 1 QB API call per second to respect QBO
 * rate limits.
 *
 * Wiring: call scheduleQbPaymentRefresh() once at boot from
 * server/bootstrap/start-runtime-services.ts (after DB init, skipped in
 * SQLite / non-production where QB tokens are absent).
 *
 * Integration health: each run is recorded via recordIntegrationRun so the
 * /api/integration-health dashboard shows freshness.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  quickbooksDocuments,
  quickbooksInvoiceLinks,
} from "@shared/schema";
import { recordIntegrationRun } from "../services/integration-health-service";
import { recordFinanceJobRun } from "../services/finance-observability/job-heartbeats";
import {
  getBillById,
  getQuickBooksConnectionStatus,
  getValidAccessToken,
  isQbReconnectRequiredError,
  queryQuickBooks,
} from "../services/quickbooks-service";

const INTEGRATION_NAME = "quickbooks-payment-refresh";
const DAILY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 5 * 60 * 1000; // ±5 min so multi-instance deploys don't pile up
const QB_RATE_LIMIT_MS = 1000; // max 1 QB API call / second

let scheduledInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function amountToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

interface RefreshResult {
  processed: number;
  updated: number;
  errors: number;
  /**
   * Set when the run was aborted because the stored QuickBooks refresh
   * token is no longer accepted by Intuit. The integration-health audit
   * uses this to record a distinct `needs_reconnect` error code instead
   * of reporting the run as a clean success.
   */
  needsReconnect?: boolean;
}

async function refreshPaymentStatus(): Promise<RefreshResult> {
  const status = await getQuickBooksConnectionStatus();
  if (!status.connected || !status.realmId) {
    return { processed: 0, updated: 0, errors: 0 };
  }

  // Probe the token once up front. If the stored refresh token has been
  // revoked, Intuit will reject it here — we abort the whole run with a
  // single concise log line instead of hitting the same error on every
  // link iteration (the loop below makes one QB call per link and would
  // otherwise emit a full stack trace per link).
  try {
    await getValidAccessToken();
  } catch (err) {
    if (isQbReconnectRequiredError(err)) {
      console.warn(
        "[qb-payment-refresh] Skipping run — QuickBooks refresh token rejected by Intuit (invalid_grant). The connection must be re-authorised via the QuickBooks integration screen before nightly payment-status refresh can resume.",
      );
      return { processed: 0, updated: 0, errors: 0, needsReconnect: true };
    }
    throw err;
  }

  const links = await db
    .select({
      id: quickbooksInvoiceLinks.id,
      qbEntityId: quickbooksInvoiceLinks.qbEntityId,
      qbEntityType: quickbooksInvoiceLinks.qbEntityType,
      qbRealmId: quickbooksInvoiceLinks.qbRealmId,
    })
    .from(quickbooksInvoiceLinks)
    .where(isNull(quickbooksInvoiceLinks.deletedAt));

  let processed = 0;
  let updated = 0;
  let errors = 0;

  for (const link of links) {
    try {
      // Rate limit: 1 call/second max.
      if (processed > 0) await sleep(QB_RATE_LIMIT_MS);
      processed++;

      if (!/^[A-Za-z0-9_-]+$/.test(link.qbEntityId)) continue;

      let qbDoc: Record<string, unknown> | null = null;
      if (link.qbEntityType === "bill") {
        qbDoc = await getBillById(link.qbEntityId);
      } else {
        const raw = await queryQuickBooks<{
          QueryResponse?: { Invoice?: unknown[] };
        }>("Invoice", `SELECT * FROM Invoice WHERE Id = '${link.qbEntityId}'`);
        qbDoc = (raw?.QueryResponse?.Invoice?.[0] as Record<string, unknown>) ?? null;
      }

      if (!qbDoc) continue;

      const total = amountToNumber((qbDoc as { TotalAmt?: unknown }).TotalAmt);
      const balance = amountToNumber((qbDoc as { Balance?: unknown }).Balance);
      let paymentStatus: "paid" | "partial" | "unpaid" | null = null;
      if (balance !== null && total !== null) {
        if (balance <= 0.01) paymentStatus = "paid";
        else if (balance < total) paymentStatus = "partial";
        else paymentStatus = "unpaid";
      }

      // Update the cached document snapshot (best-effort).
      const [doc] = await db
        .select({ id: quickbooksDocuments.id })
        .from(quickbooksDocuments)
        .where(
          and(
            eq(quickbooksDocuments.qbEntityId, link.qbEntityId),
            eq(quickbooksDocuments.qbRealmId, link.qbRealmId),
            eq(quickbooksDocuments.qbEntityType, link.qbEntityType),
            isNull(quickbooksDocuments.deletedAt),
          ),
        )
        .limit(1);

      if (doc) {
        await db
          .update(quickbooksDocuments)
          .set({
            qbBalance: balance !== null ? (String(balance) as unknown as never) : null,
            qbPaymentStatus: paymentStatus,
            updatedAt: new Date(),
          })
          .where(eq(quickbooksDocuments.id, doc.id));
        updated++;
      }
    } catch (err) {
      errors++;
      console.error(`[qb-payment-refresh] Error refreshing link ${link.id}:`, err);
    }
  }

  return { processed, updated, errors };
}

async function runWithAudit(): Promise<void> {
  const startedAt = new Date();
  let result: RefreshResult = { processed: 0, updated: 0, errors: 0 };
  let status: "success" | "failure" = "success";
  let errorDetail: string | null = null;
  let errorCode: string | null = null;

  try {
    result = await refreshPaymentStatus();
    // A skipped-due-to-reconnect run is not a "success" for integration
    // health purposes — surface it as a distinct failure so the dashboard
    // shows the connection needs re-authorisation rather than silently
    // reporting clean nightly runs while no data is being refreshed.
    if (result.needsReconnect) {
      status = "failure";
      errorCode = "needs_reconnect";
      errorDetail =
        "QuickBooks refresh token rejected by Intuit (invalid_grant). Re-authorise the connection in the QuickBooks integration screen.";
    }
  } catch (err) {
    status = "failure";
    errorCode = "refresh_failed";
    errorDetail = err instanceof Error ? err.message : String(err);
  } finally {
    await recordIntegrationRun({
      name: INTEGRATION_NAME,
      runType: "nightly_payment_refresh",
      startedAt,
      finishedAt: new Date(),
      status,
      recordsProcessed: result.processed,
      errorCode,
      errorDetail,
      metadata: { updated: result.updated, errors: result.errors },
    }).catch(() => {
      // Non-fatal — integration health log is best-effort.
    });
    // Finance dead-man's-switch heartbeat (separate per-job interval).
    await recordFinanceJobRun({
      jobKey: "qb-payment-refresh",
      status: status === "success" ? "success" : "failure",
      startedAt,
      error: errorDetail,
      metadata: { processed: result.processed, updated: result.updated, errors: result.errors },
    }).catch(() => {});
  }
}

/**
 * Register the nightly payment-status refresh scheduler.
 * Idempotent — calling twice is a no-op.
 */
export function scheduleQbPaymentRefresh(): void {
  if (scheduledInterval) return;

  const safeRun = async () => {
    const today = todayUtcDate();
    if (lastRunDate === today) return;
    lastRunDate = today;
    await runWithAudit().catch((err) =>
      console.error("[qb-payment-refresh] Unhandled error in scheduler:", err),
    );
  };

  // Fire once at startup (catches up if the server was down overnight).
  void safeRun();

  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  scheduledInterval = setInterval(safeRun, DAILY_MS + jitter);
  if (typeof scheduledInterval.unref === "function") {
    scheduledInterval.unref();
  }

  console.log("[qb-payment-refresh] Nightly payment-status refresh scheduler registered.");
}

/** Testing hook. */
export function stopQbPaymentRefreshForTests(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
    lastRunDate = null;
  }
}
