/**
 * QuickBooks Online integration routes.
 *
 * Exposes the OAuth2 flow (auth + callback), connection status,
 * and read-only data endpoints (company, invoices, customers,
 * vendors, bills, P&L).
 *
 * Authorization model (hardened):
 *   - OAuth start + disconnect          → requireAuth + requireAdmin
 *   - OAuth callback                    → NOT gated. Intuit redirects the
 *                                         browser here after consent; we
 *                                         verify via the CSRF `state` param
 *                                         stored on the session.
 *   - Status + read-only data + recon   → requireAuth + requirePermission(
 *                                            "financial_integration", "view")
 *   - Customer-mapping / link READS     → requireAuth + requirePermission(
 *                                            "financials", "view")
 *   - Customer-mapping / link WRITES    → requireAuth + requirePermission(
 *                                            "financials", "edit")
 *
 * Canonical-control boundary:
 *   QuickBooks routes MUST NOT mutate COS realisation state. The single
 *   canonical path for marking a cost line as realised is the finance
 *   tracker endpoint `/api/cos-tracker/toggle-realised/:id` (period-lock,
 *   invoice + invoice-date + placeholder validation, audit trail, metric
 *   refresh). The previous POST /api/quickbooks/cost-lines/:id/mark-realised
 *   route bypassed that control and has been disabled (HTTP 410 Gone).
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth, getEffectiveUser } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { findEntityRegistry } from "@shared/permissions/registry";
import { evaluateQbMappingLockDecision } from "./lib/quickbooks-mapping-lock-eval";
import {
  clearQbOAuthStateCookie,
  readQbOAuthStateCookie,
  setQbOAuthStateCookie,
  statesMatch,
} from "./lib/quickbooks-oauth-state";

// Lock-policy: once a mapping is locked (by an admin via the
// "Suggest matches" cascade or the unlock-then-relock flow), only an
// authorised role can subsequently change or clear it. financials:edit
// alone is no longer sufficient. See Task #30 — prevents non-admin
// editors from silently overwriting reviewed/approved mappings.
//
// Plan v3 § 2.7 / D.6 #3: COO/CEO keep their reason-optional default
// path (QB_ADMIN_ROLES below); CFO and PROGRAM_FINANCE_MANAGER (sourced
// from financials.override_roles in the registry) gain an override-
// with-reason path. See server/lib/quickbooks-mapping-lock-eval.ts.
const QB_ADMIN_ROLES: ReadonlySet<string> = new Set(["COO_ADMIN", "CEO_ADMIN"]);
const QB_LOCK_OVERRIDE_ROLES: ReadonlySet<string> = new Set(
  findEntityRegistry("financials")?.override_roles ?? [],
);
import { requirePermission } from "./permission-middleware";
import { rateLimitPerUser } from "./middleware/rateLimitPerUser";
import { logAuditFromReq } from "./audit-logger";
import {
  disconnectQuickBooks,
  exchangeCodeForTokens,
  getAuthorizationUrl,
  getBills,
  getCompanyInfo,
  getCustomers,
  getInvoices,
  getProfitAndLossReport,
  getQuickBooksConnectionStatus,
  getVendors,
} from "./services/quickbooks-service";
import {
  billRawToSummary,
  confirmCostLineLink,
  confirmRevenueLineLink,
  createOrUpdateLink,
  fetchProjectLinks,
  getCustomerMappingForProject,
  invoiceRawToSummary,
  listAllLinks,
  listProjectsWithMappings,
  QuickBooksBillNotFoundError,
  QuickBooksLinkConflictError,
  QuickBooksUnavailableError,
  runProjectCostReconciliation,
  runProjectRevenueReconciliation,
  saveCostAllocationsForBill,
  searchCostLines,
  searchRevenueLines,
  softDeleteCustomerMapping,
  softDeleteLink,
  getSiblingLinksForQbEntity,
  upsertCustomerMapping,
  type QuickBooksBillSummary,
  type QuickBooksInvoiceSummary,
} from "./services/quickbooks-reconciliation-service";
import {
  commitCustomerCascade,
  commitVendorCascade,
  previewCustomerCascade,
  previewVendorCascade,
  rankCandidates,
  recordCascadePreview,
  recordSuggestion,
  unlockCustomerMapping,
  unlockVendorMapping,
  type SuggestScope,
} from "./services/quickbooks-cascade-service";
import { recordIntegrationRun } from "./services/integration-health-service";
import { refreshProjectMetricsAsync } from "./services/dashboard-metrics";
import {
  detectAndPersistProposals,
  loadCostLineContext,
  loadRevenueLineContext,
} from "./services/quickbooks-cascade-proposals-service";
import { db } from "./db";
import {
  counterparties,
  integrations,
  integrationRunEvents,
  projectInfo,
  quickbooksCascadeRuns,
  quickbooksCustomerMappings,
  quickbooksMatchSuggestions,
  quickbooksVendorMappings,
  type IntegrationRunEvent,
} from "@shared/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "./middleware/validateBody";
import { ApiError, conflict, logApiError, sendError, serverError } from "./lib/api-error";

/**
 * Map a QB link-write exception to an HTTP response. Returns true if the
 * error was a conflict and has been handled by writing a 409 response;
 * false if the caller should fall through to the generic 500.
 */
function handleLinkConflict(res: Response, err: unknown): boolean {
  if (err instanceof QuickBooksLinkConflictError) {
    res.status(409).json({
      error: "conflict",
      code: err.code,
      reason: err.reason,
      conflicts: err.conflicts.map((c) => ({
        id: c.id,
        appEntityType: c.appEntityType,
        appEntityId: c.appEntityId,
        qbEntityType: c.qbEntityType,
        qbEntityId: c.qbEntityId,
        qbDocNumber: c.qbDocNumber,
        qbCounterpartyName: c.qbCounterpartyName,
        qbAmount: c.qbAmount,
        qbTxnDate: c.qbTxnDate,
        projectId: c.projectId,
        confirmedAt: c.confirmedAt,
      })),
    });
    return true;
  }
  return false;
}

type SessionWithQbState = Request["session"] & { qbState?: string };

function quickBooksFailure(
  res: Response,
  context: string,
  status: number,
  errorCode: string,
  message: string,
  err: unknown,
): void {
  logApiError(context, err);
  res.status(status).json({ error: errorCode, message });
}

function quickBooksServerFailure(
  res: Response,
  context: string,
  errorCode: string,
  message: string,
  err: unknown,
): void {
  quickBooksFailure(res, context, 500, errorCode, message, err);
}

function notConnectedResponse(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "QuickBooks error";
  if (/not connected/i.test(message)) {
    quickBooksFailure(res, "quickbooks.integration.not_connected", 409, "quickbooks_not_connected", "QuickBooks is not connected", err);
    return;
  }
  quickBooksFailure(res, "quickbooks.integration.api_error", 502, "quickbooks_api_error", "QuickBooks request failed", err);
}

export function registerQuickBooksRoutes(app: Express): void {
  // ---------- OAuth flow ----------

  app.get("/api/quickbooks/auth", requireAuth, requireAdmin, async (req, res) => {
    try {
      const state = crypto.randomBytes(24).toString("hex");
      (req.session as SessionWithQbState).qbState = state;

      await new Promise<void>((resolve, reject) => {
        if (typeof req.session?.save === "function") {
          req.session.save((err) => (err ? reject(err) : resolve()));
        } else {
          resolve();
        }
      });

      // Dedicated cross-site-safe state cookie (see QB_OAUTH_STATE_COOKIE note);
      // complements the session-stored qbState so the callback can verify even
      // when the SameSite=Lax session cookie isn't sent on the Intuit redirect.
      setQbOAuthStateCookie(res, state);

      const url = getAuthorizationUrl(state);
      res.redirect(url);
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.oauth.start", "quickbooks_auth_failed", "Failed to start QuickBooks authorization", err);
    }
  });

  app.get("/api/quickbooks/callback", async (req, res) => {
    try {
      // Diagnostic: log all query params Intuit sent back
      console.log(`[QuickBooks callback] Full query params:`, req.query);

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const realmId = typeof req.query.realmId === "string" ? req.query.realmId : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const error = typeof req.query.error === "string" ? req.query.error : "";

      if (error) {
        logAuditFromReq(req, {
          entityType: "quickbooks_integration",
          entityId: "quickbooks",
          action: "quickbooks.oauth.failed",
          source: "SETTINGS",
          changesJson: { reason: "intuit_error", message: error },
        });
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent(error)}`);
        return;
      }

      if (!code || !realmId || !state) {
        logAuditFromReq(req, {
          entityType: "quickbooks_integration",
          entityId: "quickbooks",
          action: "quickbooks.oauth.failed",
          source: "SETTINGS",
          changesJson: { reason: "missing_params" },
        });
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent("Missing code, realmId, or state")}`);
        return;
      }

      const sessionState = (req.session as SessionWithQbState)?.qbState;
      const cookieState = readQbOAuthStateCookie(req);

      // Verify against EITHER the session (Lax) or the dedicated cross-site
      // cookie (None) — whichever the browser sent back. The cookie is the
      // robust path: the session cookie is frequently dropped on the cross-site
      // Intuit redirect, which used to fail every reconnect as "Invalid CSRF
      // state" even though auth-start saved the state correctly.
      const matchedSession = statesMatch(state, sessionState);
      const matchedCookie = statesMatch(state, cookieState);
      const valid = matchedSession || matchedCookie;

      // Diagnostic: understand why a CSRF state check fails (no secrets logged).
      console.log(`[QuickBooks callback] Session ID: ${req.sessionID ?? "NONE"}`);
      console.log(`[QuickBooks callback] qbState on session: ${sessionState ? "present" : "UNDEFINED"} · state cookie: ${cookieState ? "present" : "UNDEFINED"} · query state: ${state ? "present" : "EMPTY"}`);
      console.log(`[QuickBooks callback] Match — session: ${matchedSession}, cookie: ${matchedCookie}`);

      if (!valid) {
        logAuditFromReq(req, {
          entityType: "quickbooks_integration",
          entityId: "quickbooks",
          action: "quickbooks.oauth.failed",
          source: "SETTINGS",
          changesJson: {
            reason: "csrf_mismatch",
            hadSession: !!req.session,
            hadSessionState: !!sessionState,
            hadCookieState: !!cookieState,
            stateFromQuery: !!state,
          },
        });
        clearQbOAuthStateCookie(res);
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent("Invalid CSRF state")}`);
        return;
      }

      // One-shot: clear the state (session + cookie) once verified.
      delete (req.session as SessionWithQbState).qbState;
      clearQbOAuthStateCookie(res);

      await exchangeCodeForTokens(code, realmId);

      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.oauth.connected",
        source: "SETTINGS",
        changesJson: { realmId },
      });
      res.redirect(`/admin/quickbooks?quickbooks=connected`);
    } catch (err) {
      const message = "QuickBooks callback failed";
      logApiError("quickbooks.oauth.callback", err);
      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.oauth.failed",
        source: "SETTINGS",
        changesJson: {
          reason: "exchange_failed",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent(message)}`);
    }
  });

  // ---------- Connection status ----------

  app.get("/api/quickbooks/status", requireAuth, requirePermission("financial_integration", "view"), async (_req, res) => {
    try {
      const status = await getQuickBooksConnectionStatus();
      res.json(status);
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.status", "quickbooks_status_failed", "Failed to load QuickBooks status", err);
    }
  });

  app.post("/api/quickbooks/disconnect", requireAuth, requireAdmin, async (req, res) => {
    try {
      await disconnectQuickBooks();
      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.disconnect",
        source: "SETTINGS",
        changesJson: { reason: "manual_disconnect" },
      });
      res.json({ connected: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect";
      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.disconnect_failed",
        source: "SETTINGS",
        changesJson: { error: message },
      });
      quickBooksServerFailure(res, "quickbooks.disconnect", "quickbooks_disconnect_failed", "Failed to disconnect QuickBooks", err);
    }
  });

  // ---------- Sync Now (manual refresh) ----------
  //
  // Triggers a pull of bills, invoices, customers, vendors and P&L.
  // Logs the run to integration_run_events so the health tile and
  // sync log both update in real time.
  // Sync-now performs writes (snapshot ingest, integration_run_events insert),
  // so it must require an editor permission. Viewers get 403. Hardened in
  // Task #30 (was previously gated as `financial_integration:view`, which let
  // any viewer trigger writes against the integration).
  // TF-15 (audit V3) — sync-now triggers the full QB pull. Heavy
  // operation; rate-limit to one run per 5 minutes per user to keep
  // operators from accidentally double-firing it.
  app.post(
    "/api/quickbooks/sync-now",
    requireAuth,
    requirePermission("financials", "edit"),
    rateLimitPerUser({ bucket: "qb-sync-now", maxRequests: 1, windowSeconds: 300 }),
    async (req, res) => {
      const startedAt = new Date();
      const errors: string[] = [];
      const errorDetails: string[] = [];
      let recordsProcessed = 0;

      const safeCall = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
        try {
          const result = await fn();
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logApiError(`quickbooks.sync_now.${label}`, err);
          errorDetails.push(`${label}: ${message}`);
          errors.push(`${label}: failed`);
          return null;
        }
      };

      const billsEnd = new Date();
      const billsStart = new Date(billsEnd.getFullYear(), billsEnd.getMonth() - 11, 1);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const [invoicesData, customersData, vendorsData, billsData, pnlData] = await Promise.all([
        safeCall("invoices", () => getInvoices(iso(billsStart), iso(billsEnd))),
        safeCall("customers", () => getCustomers()),
        safeCall("vendors", () => getVendors()),
        safeCall("bills", () => getBills(iso(billsStart), iso(billsEnd))),
        safeCall("pnl", () => getProfitAndLossReport(iso(billsStart), iso(billsEnd))),
      ]);

      const countQr = (resp: any, key: string) => {
        const arr = resp?.QueryResponse?.[key];
        return Array.isArray(arr) ? arr.length : 0;
      };
      recordsProcessed =
        countQr(invoicesData, "Invoice") +
        countQr(customersData, "Customer") +
        countQr(vendorsData, "Vendor") +
        countQr(billsData, "Bill") +
        (pnlData ? 1 : 0);

      const status = errors.length === 0 ? "success" : errors.length >= 5 ? "failure" : "partial";

      try {
        await recordIntegrationRun({
          name: "quickbooks",
          runType: "manual_sync",
          startedAt,
          finishedAt: new Date(),
          status,
          recordsProcessed,
          errorCode: errors.length > 0 ? "partial_sync_errors" : null,
          errorDetail: errorDetails.length > 0 ? errorDetails.join(" | ").slice(0, 1000) : null,
        });
      } catch (err) {
        // Logging is best-effort — don't block the response.
        console.error("[quickbooks][sync-now] failed to record integration run", err);
      }

      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.sync_now",
        source: "SETTINGS",
        changesJson: { status, recordsProcessed, errors: errors.length },
      });

      res.json({
        ok: errors.length === 0,
        status,
        recordsProcessed,
        errors,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      });
    },
  );

  // ---------- Sync log (recent integration_run_events for QB) ----------
  app.get(
    "/api/quickbooks/sync-log",
    requireAuth,
    requirePermission("financial_integration", "view"),
    async (_req, res) => {
      try {
        const [qb] = await db
          .select()
          .from(integrations)
          .where(eq(integrations.name, "quickbooks"))
          .limit(1);

        if (!qb) {
          res.json({ events: [] });
          return;
        }

        const rows = await db
          .select()
          .from(integrationRunEvents)
          .where(eq(integrationRunEvents.integrationId, qb.id))
          .orderBy(desc(integrationRunEvents.startedAt))
          .limit(50);

        const events = rows.map((r: IntegrationRunEvent) => ({
          id: r.id,
          runAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          status: r.status === "success" ? "ok" : r.status === "failure" ? "error" : "running",
          kind: r.runType,
          message: r.errorDetail ?? (r.status === "success" ? "Completed successfully" : null),
          recordCount: r.recordsProcessed,
        }));

        res.json({ events });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.sync_log", "quickbooks_sync_log_failed", "Failed to load QuickBooks sync log", err);
      }
    },
  );

  // ---------- Data endpoints ----------

  app.get("/api/quickbooks/company", requireAuth, requirePermission("financial_integration", "view"), async (_req, res) => {
    try {
      const info = await getCompanyInfo();
      res.json(info);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/invoices", requireAuth, requirePermission("financial_integration", "view"), async (req, res) => {
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
      const data = await getInvoices(startDate, endDate);
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/customers", requireAuth, requirePermission("financial_integration", "view"), async (_req, res) => {
    try {
      const data = await getCustomers();
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/vendors", requireAuth, requirePermission("financial_integration", "view"), async (_req, res) => {
    try {
      const data = await getVendors();
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/bills", requireAuth, requirePermission("financial_integration", "view"), async (req, res) => {
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
      const data = await getBills(startDate, endDate);
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/reports/pnl", requireAuth, requirePermission("financial_integration", "view"), async (req, res) => {
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";
      if (!startDate || !endDate) {
        res.status(400).json({ error: "bad_request", message: "startDate and endDate are required (YYYY-MM-DD)" });
        return;
      }
      const data = await getProfitAndLossReport(startDate, endDate);
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  // ---------- Reconciliation (COS: QB Bills ↔ normalized_cost_lines) ----------

  app.get(
    "/api/quickbooks/projects/:projectId/cos-reconciliation",
    requireAuth,
    requirePermission("financial_integration", "view"),
    async (req, res) => {
      try {
        const projectId = Number(req.params.projectId);
        if (!Number.isFinite(projectId) || projectId <= 0) {
          res.status(400).json({ error: "bad_request", message: "Invalid projectId" });
          return;
        }
        const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
        const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
        const result = await runProjectCostReconciliation(projectId, { startDate, endDate });

        // W6: Surface QB freshness in reconciliation response so the UI
        // can warn when data is stale. Non-blocking — never fails the endpoint.
        let _freshness: { isStale: boolean; ageMs: number | null; warning: string | null } | undefined;
        try {
          const status = await getQuickBooksConnectionStatus();
          _freshness = {
            isStale: status.isStale,
            ageMs: status.ageMs,
            warning: status.isStale
              ? "QuickBooks data may be stale — reconciliation results could differ from current QuickBooks state."
              : null,
          };
        } catch { /* non-blocking */ }

        res.json({ ...result, _freshness });
      } catch (err) {
        notConnectedResponse(res, err);
      }
    },
  );

  app.get("/api/quickbooks/projects/:projectId/links", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid projectId" });
        return;
      }
      const links = await fetchProjectLinks(projectId);
      res.json({ links });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.links.project", "quickbooks_links_failed", "Failed to fetch QuickBooks links", err);
    }
  });

  // ---------- Global links (cross-project) ----------

  app.get("/api/quickbooks/links", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;
      const links = await listAllLinks(Number.isFinite(limit) ? limit : 500);
      res.json({ links });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.links.list", "quickbooks_links_failed", "Failed to list QuickBooks links", err);
    }
  });

  app.post("/api/quickbooks/links", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
    try {
      const body = req.body ?? {};
      const costLineId = Number(body.costLineId ?? body.appEntityId);
      const projectId = body.projectId !== undefined && body.projectId !== null ? Number(body.projectId) : null;
      if (!Number.isFinite(costLineId) || costLineId <= 0) {
        res.status(400).json({ error: "bad_request", message: "costLineId is required" });
        return;
      }

      // Accept either a raw QB bill object, or a pre-summarised snapshot.
      let billSummary: QuickBooksBillSummary | null = null;
      if (body.bill && typeof body.bill === "object") {
        billSummary =
          typeof body.bill.Id !== "undefined"
            ? billRawToSummary(body.bill)
            : (body.bill as QuickBooksBillSummary);
      }

      if (!billSummary || !billSummary.id) {
        res.status(400).json({ error: "bad_request", message: "bill (with id) is required" });
        return;
      }

      const user = getEffectiveUser(req);
      try {
        const link = await confirmCostLineLink({
          projectId,
          costLineId,
          bill: billSummary,
          matchType: body.matchType ?? "manual",
          notes: body.notes ?? null,
          confirmedBy: user?.id ?? null,
        });
        logAuditFromReq(req, {
          entityType: "quickbooks_invoice_link",
          entityId: String(link.id),
          action: "quickbooks.link.confirm",
          source: "UI",
          changesJson: {
            appEntityType: "cost_line",
            appEntityId: costLineId,
            qbEntityType: "bill",
            qbEntityId: billSummary.id,
            qbDocNumber: billSummary.docNumber,
            qbAmount: billSummary.totalAmount,
            projectId,
            matchType: body.matchType ?? "manual",
          },
        });
        if (link.projectId) {
          refreshProjectMetricsAsync(link.projectId);
        }

        // Cascade detector — emit proposals for any QB-vs-app divergence.
        let proposals: Awaited<ReturnType<typeof detectAndPersistProposals>> = [];
        try {
          const appCtx = await loadCostLineContext(costLineId);
          if (appCtx) {
            proposals = await detectAndPersistProposals({
              link,
              app: appCtx,
              qb: {
                qbEntityType: "bill",
                qbEntityId: billSummary.id,
                qbRealmId: link.qbRealmId,
                qbDocNumber: billSummary.docNumber ?? null,
                qbTxnDate: billSummary.txnDate ?? null,
                qbAmountExVat: billSummary.qbAmountExVat ?? billSummary.totalAmount ?? null,
                qbAmountIncVat: billSummary.qbAmountIncVat ?? null,
                qbTaxAmount: billSummary.qbTaxAmount ?? null,
                qbCounterpartyId: billSummary.vendorId ?? null,
                qbCounterpartyName: billSummary.vendorName ?? null,
              },
              createdBy: user?.id ?? null,
            });
          }
        } catch (detectErr) {
          console.error("[quickbooks][POST /links] cascade detector failed", detectErr);
        }

        res.status(201).json({ link, proposals });
      } catch (inner) {
        if (handleLinkConflict(res, inner)) {
          logAuditFromReq(req, {
            entityType: "quickbooks_invoice_link",
            entityId: `cost_line:${costLineId}`,
            action: "quickbooks.link.conflict",
            source: "UI",
            changesJson: {
              appEntityType: "cost_line",
              appEntityId: costLineId,
              qbEntityId: billSummary.id,
              reason: (inner as QuickBooksLinkConflictError).reason,
            },
          });
          return;
        }
        throw inner;
      }
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.links.create", "quickbooks_link_failed", "Failed to create QuickBooks link", err);
    }
  });

  const bulkAssignSchema = z.object({
    projectId: z.number().int().positive(),
    // Bill Id only — server re-fetches the Bill from QB to re-derive all
    // VAT / amount / vendor fields. The client cannot influence stored
    // evidence amounts.
    billId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid QuickBooks Bill Id"),
    allocations: z
      .array(
        z.object({
          costLineId: z.number().int().positive(),
          amountExVat: z.number().positive().finite(),
        }),
      )
      .max(500),
  });
  type BulkAssignBody = z.infer<typeof bulkAssignSchema>;

  app.post(
    "/api/quickbooks/cost-allocations/bulk-assign",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(bulkAssignSchema),
    async (req, res) => {
      const body = req.body as BulkAssignBody;
      try {
        const result = await saveCostAllocationsForBill({
          projectId: body.projectId,
          billId: body.billId,
          allocations: body.allocations.map((a) => ({
            projectId: body.projectId,
            costLineId: a.costLineId,
            amountExVat: a.amountExVat,
          })),
          actorId: getEffectiveUser(req)?.id ?? null,
        });

        logAuditFromReq(req, {
          entityType: "quickbooks_cost_allocations",
          entityId: String(result.documentId),
          action: "quickbooks.cost_allocation.bulk_assign",
          source: "UI",
          changesJson: {
            projectId: body.projectId,
            qbEntityId: body.billId,
            allocationCount: body.allocations.length,
            assignedExVat: result.assignedExVat,
            remainingExVat: result.remainingExVat,
            status: result.status,
            taxUncertain: result.taxUncertain,
          },
        });

        res.json({ success: true, ...result });
      } catch (err) {
        if (err instanceof QuickBooksUnavailableError) {
          logApiError("quickbooks.cost_allocation.bulk_assign.unavailable", err);
          return sendError(
            res,
            new ApiError(503, "quickbooks_unavailable", "QuickBooks is unavailable. Reconnect QuickBooks or try again later."),
          );
        }
        if (err instanceof QuickBooksBillNotFoundError) {
          logApiError("quickbooks.cost_allocation.bulk_assign.bill_not_found", err);
          return sendError(
            res,
            new ApiError(404, "quickbooks_bill_not_found", "The selected QuickBooks bill could not be found."),
          );
        }
        if (err instanceof Error && /Over-assignment blocked/i.test(err.message)) {
          logApiError("quickbooks.cost_allocation.bulk_assign.over_assignment", err);
          return sendError(res, conflict("Over-assignment blocked"));
        }
        logApiError("quickbooks.cost_allocation.bulk_assign", err);
        return sendError(res, serverError("Failed to save QuickBooks cost allocations."));
      }
    },
  );

  // Once a QB link is established, breaking it is an admin-only action so
  // finance can't accidentally re-shuffle reconciled allocations. The
  // canonical "I want to repoint this link" flow is the new POST
  // /api/quickbooks/links/:id/force-relink endpoint, which is also admin-only.
  app.delete("/api/quickbooks/links/:id", requireAuth, requirePermission("financials", "edit"), requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid link id" });
        return;
      }
      const previous = await softDeleteLink(id);
      if (!previous) {
        res.status(404).json({ error: "not_found", message: "Link not found" });
        return;
      }
      if (previous.projectId) {
        refreshProjectMetricsAsync(previous.projectId);
      }
      // Task #142 — surface remaining sibling allocation so the caller can
      // immediately reflect "X of Y still allocated" without an extra round
      // trip. Soft-deleting one link does NOT touch the others.
      const remainingSiblings = await getSiblingLinksForQbEntity(
        previous.qbEntityType as "bill" | "invoice",
        previous.qbEntityId,
        previous.qbRealmId,
        previous.qbAmount != null ? Number(previous.qbAmount) : null,
      );
      logAuditFromReq(req, {
        entityType: "quickbooks_invoice_link",
        entityId: String(id),
        action: "quickbooks.link.unlink",
        source: "UI",
        changesJson: {
          appEntityType: previous.appEntityType,
          appEntityId: previous.appEntityId,
          qbEntityType: previous.qbEntityType,
          qbEntityId: previous.qbEntityId,
          projectId: previous.projectId,
          qbDocNumber: previous.qbDocNumber,
          qbAmount: previous.qbAmount,
          remainingSiblingCount: remainingSiblings.links.length,
          remainingAllocatedExVat: remainingSiblings.totalAllocatedExVat,
        },
      });
      res.json({
        ok: true,
        qbEntity: {
          qbEntityType: previous.qbEntityType,
          qbEntityId: previous.qbEntityId,
          qbAmount: previous.qbAmount,
        },
        remainingSiblings: {
          count: remainingSiblings.links.length,
          totalAllocatedExVat: remainingSiblings.totalAllocatedExVat,
          remainingExVat: remainingSiblings.remainingExVat,
        },
      });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.links.delete", "quickbooks_link_delete_failed", "Failed to delete QuickBooks link", err);
    }
  });

  // POST /api/quickbooks/links/:id/force-relink
  //
  // Admin-only re-point. Soft-deletes the existing link and creates a new
  // one against a different QB doc (or, less commonly, a different app
  // entity) in a single transaction. This is the only sanctioned way to
  // override the 1:1 invariant — finance roles get a 409 from the regular
  // approve flow when an active link already exists. Audit row carries
  // both the previous and new link payload so the trail is unambiguous.
  app.post(
    "/api/quickbooks/links/:id/force-relink",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ error: "bad_request", message: "Invalid link id" });
          return;
        }
        const body = (req.body ?? {}) as {
          qbEntityType?: "bill" | "invoice";
          qbEntityId?: string;
          qbRealmId?: string;
          qbDocNumber?: string | null;
          qbTxnDate?: string | null;
          qbAmountExVat?: number | null;
          qbCounterpartyName?: string | null;
          notes?: string | null;
          reason?: string | null;
        };
        if (!body.qbEntityType || !body.qbEntityId || !body.qbRealmId) {
          res.status(400).json({
            error: "bad_request",
            message: "qbEntityType, qbEntityId and qbRealmId are required",
          });
          return;
        }
        const previous = await softDeleteLink(id);
        if (!previous) {
          res.status(404).json({ error: "not_found", message: "Link not found" });
          return;
        }
        const userId = getEffectiveUser(req)?.id ?? null;
        const link = await createOrUpdateLink({
          projectId: previous.projectId ?? null,
          appEntityType: previous.appEntityType as "cost_line" | "revenue_line",
          appEntityId: previous.appEntityId,
          qbEntityType: body.qbEntityType,
          qbEntityId: body.qbEntityId,
          qbRealmId: body.qbRealmId,
          qbDocNumber: body.qbDocNumber ?? null,
          qbTxnDate: body.qbTxnDate ?? null,
          qbAmount: body.qbAmountExVat ?? null,
          qbCounterpartyName: body.qbCounterpartyName ?? null,
          matchType: "manual",
          notes: body.notes ?? null,
          confirmedBy: userId,
          allocatedAmountExVat: body.qbAmountExVat ?? null,
        });
        if (link.projectId) {
          refreshProjectMetricsAsync(link.projectId);
        }
        if (previous.projectId && previous.projectId !== link.projectId) {
          refreshProjectMetricsAsync(previous.projectId);
        }

        // Run the cascade detector against the freshly-pointed link so the
        // reviewer sees the proposed updates for the new QB doc.
        try {
          const appCtx =
            previous.appEntityType === "cost_line"
              ? await loadCostLineContext(previous.appEntityId)
              : await loadRevenueLineContext(previous.appEntityId);
          if (appCtx) {
            await detectAndPersistProposals({
              link,
              app: appCtx,
              qb: {
                qbEntityType: body.qbEntityType,
                qbEntityId: body.qbEntityId,
                qbRealmId: body.qbRealmId,
                qbDocNumber: body.qbDocNumber ?? null,
                qbTxnDate: body.qbTxnDate ?? null,
                qbAmountExVat: body.qbAmountExVat ?? null,
                qbCounterpartyId: null,
                qbCounterpartyName: body.qbCounterpartyName ?? null,
              },
              createdBy: userId,
            });
          }
        } catch (detectErr) {
          // Detector is best-effort — log but don't fail the relink.
          console.error("[quickbooks][force-relink] cascade detector failed", detectErr);
        }

        logAuditFromReq(req, {
          entityType: "quickbooks_invoice_link",
          entityId: String(link.id),
          action: "quickbooks.link.force_relink",
          source: "UI",
          changesJson: {
            previousLinkId: id,
            previousQbEntityType: previous.qbEntityType,
            previousQbEntityId: previous.qbEntityId,
            previousQbDocNumber: previous.qbDocNumber,
            newQbEntityType: body.qbEntityType,
            newQbEntityId: body.qbEntityId,
            newQbDocNumber: body.qbDocNumber,
            reason: body.reason ?? null,
          },
        });
        res.status(201).json({ link });
      } catch (err) {
        if (handleLinkConflict(res, err)) return;
        quickBooksServerFailure(res, "quickbooks.links.force_relink", "quickbooks_force_relink_failed", "Failed to force-relink QuickBooks evidence", err);
      }
    },
  );

  // ---- DISABLED: QuickBooks mark-realised bypass (hardening) ----
  //
  // This endpoint previously wrote `cos_realised = true` and
  // `paid_date_confirmed = true` directly on normalized_cost_lines from the
  // QuickBooks reconciliation tab. That bypassed every canonical finance
  // control:
  //   - no admin gate
  //   - no COS period lock check
  //   - no invoice-number presence / placeholder check
  //   - no invoice-date presence check
  //   - no audit-trail entry
  //   - no project metric refresh
  //
  // Marking a cost line as realised is now ONLY permitted via the canonical
  // finance control path: PATCH /api/cos-tracker/toggle-realised/:id (which
  // enforces all of the above). This endpoint is retained as HTTP 410 Gone
  // so any stale client gets a clear signal instead of silently writing.
  app.post("/api/quickbooks/cost-lines/:id/mark-realised", requireAuth, requireAdmin, (_req, res) => {
    res.status(410).json({
      error: "gone",
      code: "quickbooks_mark_realised_disabled",
      message:
        "Marking a cost line as COS-realised from the QuickBooks reconciliation view is disabled. Use the canonical finance control path: PATCH /api/cos-tracker/toggle-realised/:id (admin-only, period-lock + invoice-evidence enforced, audited).",
      canonicalPath: "/api/cos-tracker/toggle-realised/:id",
    });
  });

  // ---------- Customer mapping ----------

  app.get("/api/quickbooks/customer-mappings", requireAuth, requirePermission("financials", "view"), async (_req, res) => {
    try {
      const projects = await listProjectsWithMappings();
      res.json({ projects });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.customer_mappings.list", "quickbooks_mappings_failed", "Failed to load QuickBooks mappings", err);
    }
  });

  app.get(
    "/api/quickbooks/projects/:projectId/customer-mapping",
    requireAuth,
    requirePermission("financials", "view"),
    async (req, res) => {
      try {
        const projectId = Number(req.params.projectId);
        if (!Number.isFinite(projectId) || projectId <= 0) {
          res.status(400).json({ error: "bad_request", message: "Invalid projectId" });
          return;
        }
        const mapping = await getCustomerMappingForProject(projectId);
        res.json({ mapping });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.customer_mappings.project", "quickbooks_mapping_failed", "Failed to load QuickBooks mapping", err);
      }
    },
  );

  app.post("/api/quickbooks/customer-mappings", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
    try {
      const body = req.body ?? {};
      const projectId = Number(body.projectId);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        res.status(400).json({ error: "bad_request", message: "projectId is required" });
        return;
      }
      const qbCustomerId = typeof body.qbCustomerId === "string" ? body.qbCustomerId : "";
      if (!qbCustomerId) {
        res.status(400).json({ error: "bad_request", message: "qbCustomerId is required" });
        return;
      }
      // Lock policy: if there is an existing locked mapping for this project,
      // only an admin role may overwrite it.
      const { quickbooksCustomerMappings: qbcm } = await import("@shared/schema");
      const [lockedExisting] = await db
        .select({ id: qbcm.id, lockedAt: qbcm.lockedAt })
        .from(qbcm)
        .where(and(eq(qbcm.projectId, projectId), isNull(qbcm.deletedAt)))
        .limit(1);
      const lockDecision = lockedExisting?.lockedAt
        ? evaluateQbMappingLockDecision({
            userRole: req.user?.role,
            rawOverrideReason: req.body?.override_reason,
            defaultRoles: QB_ADMIN_ROLES,
            overrideRoles: QB_LOCK_OVERRIDE_ROLES,
          })
        : null;
      if (lockDecision?.kind === "reject") {
        res.status(lockDecision.status).json({
          ...lockDecision.body,
          mappingId: lockedExisting!.id,
        });
        return;
      }
      const overrideApplied = lockDecision?.kind === "proceed_with_override";
      const overrideReason =
        lockDecision?.kind === "proceed_with_override" ? lockDecision.reason : null;
      const user = getEffectiveUser(req);
      const mapping = await upsertCustomerMapping({
        projectId,
        clientId: body.clientId !== undefined && body.clientId !== null ? Number(body.clientId) : null,
        qbCustomerId,
        qbCustomerName: body.qbCustomerName ?? null,
        notes: body.notes ?? null,
        createdBy: user?.id ?? null,
      });
      logAuditFromReq(req, {
        entityType: "quickbooks_customer_mapping",
        entityId: String(mapping.id),
        action: overrideApplied
          ? "quickbooks.mapping.upsert_with_override"
          : "quickbooks.mapping.upsert",
        source: "UI",
        changesJson: {
          projectId,
          clientId: mapping.clientId,
          qbCustomerId: mapping.qbCustomerId,
          qbCustomerName: mapping.qbCustomerName,
          qbRealmId: mapping.qbRealmId,
          ...(overrideApplied
            ? {
                lockOverridden: true,
                overrideApplied: true,
                overrideReason,
              }
            : {}),
        },
      });
      res.status(201).json({
        mapping,
        ...(overrideApplied
          ? { override_applied: true, override_reason: overrideReason }
          : {}),
      });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.customer_mappings.save", "quickbooks_mapping_save_failed", "Failed to save QuickBooks mapping", err);
    }
  });

  app.delete("/api/quickbooks/customer-mappings/:id", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid mapping id" });
        return;
      }
      // Lock policy: locked mappings can only be unmapped by admins.
      const { quickbooksCustomerMappings: qbcm } = await import("@shared/schema");
      const [pre] = await db
        .select({ lockedAt: qbcm.lockedAt })
        .from(qbcm)
        .where(eq(qbcm.id, id))
        .limit(1);
      const lockDecision = pre?.lockedAt
        ? evaluateQbMappingLockDecision({
            userRole: req.user?.role,
            rawOverrideReason: req.body?.override_reason,
            defaultRoles: QB_ADMIN_ROLES,
            overrideRoles: QB_LOCK_OVERRIDE_ROLES,
          })
        : null;
      if (lockDecision?.kind === "reject") {
        res.status(lockDecision.status).json(lockDecision.body);
        return;
      }
      const overrideApplied = lockDecision?.kind === "proceed_with_override";
      const overrideReason =
        lockDecision?.kind === "proceed_with_override" ? lockDecision.reason : null;
      const previous = await softDeleteCustomerMapping(id);
      if (!previous) {
        res.status(404).json({ error: "not_found", message: "Mapping not found" });
        return;
      }
      logAuditFromReq(req, {
        entityType: "quickbooks_customer_mapping",
        entityId: String(id),
        action: overrideApplied
          ? "quickbooks.mapping.unmap_with_override"
          : "quickbooks.mapping.unmap",
        source: "UI",
        changesJson: {
          projectId: previous.projectId,
          clientId: previous.clientId,
          qbCustomerId: previous.qbCustomerId,
          qbCustomerName: previous.qbCustomerName,
          qbRealmId: previous.qbRealmId,
          ...(overrideApplied
            ? { lockOverridden: true, overrideApplied: true, overrideReason }
            : {}),
        },
      });
      res.json({
        ok: true,
        ...(overrideApplied
          ? { override_applied: true, override_reason: overrideReason }
          : {}),
      });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.customer_mappings.delete", "quickbooks_mapping_delete_failed", "Failed to delete QuickBooks mapping", err);
    }
  });

  // ---------- Vendor mappings (QB Vendor ↔ App Counterparty) ----------

  app.get(
    "/api/quickbooks/vendor-mappings",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req, res) => {
      try {
        const { quickbooksVendorMappings } = await import("@shared/schema");
        const { counterparties } = await import("@shared/schema/finance");
        const rows = await db
          .select({
            id: quickbooksVendorMappings.id,
            qbVendorId: quickbooksVendorMappings.qbVendorId,
            qbVendorName: quickbooksVendorMappings.qbVendorName,
            qbRealmId: quickbooksVendorMappings.qbRealmId,
            counterpartyId: quickbooksVendorMappings.counterpartyId,
            counterpartyName: quickbooksVendorMappings.counterpartyName,
            counterpartyCurrent: counterparties.nameCanonical,
            updatedAt: quickbooksVendorMappings.updatedAt,
          })
          .from(quickbooksVendorMappings)
          .leftJoin(counterparties, eq(quickbooksVendorMappings.counterpartyId, counterparties.id))
          .where(isNull(quickbooksVendorMappings.deletedAt));
        res.json({ mappings: rows });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.vendor_mappings.list", "quickbooks_vendor_mappings_failed", "Failed to load QuickBooks vendor mappings", err);
      }
    },
  );

  app.post(
    "/api/quickbooks/vendor-mappings",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const qbVendorId = String(body.qbVendorId ?? "").trim();
        const counterpartyId = Number(body.counterpartyId);
        const qbVendorName = body.qbVendorName ? String(body.qbVendorName) : null;
        const counterpartyName = body.counterpartyName ? String(body.counterpartyName) : null;
        if (!qbVendorId || !Number.isFinite(counterpartyId) || counterpartyId <= 0) {
          res.status(400).json({
            error: "bad_request",
            message: "qbVendorId and counterpartyId are required",
          });
          return;
        }

        const status = await getQuickBooksConnectionStatus();
        if (!status.connected || !status.realmId) {
          res.status(409).json({ error: "not_connected", message: "QuickBooks is not connected" });
          return;
        }

        const { quickbooksVendorMappings } = await import("@shared/schema");
        const user = getEffectiveUser(req);

        const [existing] = await db
          .select()
          .from(quickbooksVendorMappings)
          .where(
            and(
              eq(quickbooksVendorMappings.qbVendorId, qbVendorId),
              eq(quickbooksVendorMappings.qbRealmId, status.realmId),
              isNull(quickbooksVendorMappings.deletedAt),
            ),
          )
          .limit(1);

        // Lock policy: a locked vendor mapping can only be modified by an
        // admin OR an authorised role with override_reason. Plan v3 § 2.7.
        const lockDecision = existing?.lockedAt
          ? evaluateQbMappingLockDecision({
              userRole: req.user?.role,
              rawOverrideReason: req.body?.override_reason,
              defaultRoles: QB_ADMIN_ROLES,
              overrideRoles: QB_LOCK_OVERRIDE_ROLES,
            })
          : null;
        if (lockDecision?.kind === "reject") {
          res.status(lockDecision.status).json({
            ...lockDecision.body,
            mappingId: existing!.id,
          });
          return;
        }
        const overrideApplied = lockDecision?.kind === "proceed_with_override";
        const overrideReason =
          lockDecision?.kind === "proceed_with_override" ? lockDecision.reason : null;

        let row;
        if (existing) {
          const [updated] = await db
            .update(quickbooksVendorMappings)
            .set({
              counterpartyId,
              counterpartyName,
              qbVendorName,
              updatedAt: new Date(),
            })
            .where(eq(quickbooksVendorMappings.id, existing.id))
            .returning();
          row = updated;
        } else {
          const [created] = await db
            .insert(quickbooksVendorMappings)
            .values({
              qbVendorId,
              qbVendorName,
              qbRealmId: status.realmId,
              counterpartyId,
              counterpartyName,
              createdBy: user?.id ?? null,
            })
            .returning();
          row = created;
        }

        logAuditFromReq(req, {
          entityType: "quickbooks_vendor_mapping",
          entityId: String(row.id),
          action: overrideApplied
            ? (existing
                ? "quickbooks.vendor_mapping.update_with_override"
                : "quickbooks.vendor_mapping.create_with_override")
            : (existing ? "quickbooks.vendor_mapping.update" : "quickbooks.vendor_mapping.create"),
          source: "UI",
          changesJson: {
            qbVendorId,
            qbVendorName,
            counterpartyId,
            counterpartyName,
            ...(overrideApplied
              ? { lockOverridden: true, overrideApplied: true, overrideReason }
              : {}),
          },
        });

        res.json({
          mapping: row,
          ...(overrideApplied
            ? { override_applied: true, override_reason: overrideReason }
            : {}),
        });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.vendor_mappings.save", "quickbooks_vendor_mapping_save_failed", "Failed to save QuickBooks vendor mapping", err);
      }
    },
  );

  app.delete(
    "/api/quickbooks/vendor-mappings/:id",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ error: "bad_request", message: "Invalid mapping id" });
          return;
        }
        const { quickbooksVendorMappings } = await import("@shared/schema");
        // Lock policy: locked vendor mappings can only be unmapped by admins.
        const [pre] = await db
          .select({ lockedAt: quickbooksVendorMappings.lockedAt })
          .from(quickbooksVendorMappings)
          .where(eq(quickbooksVendorMappings.id, id))
          .limit(1);
        const lockDecision = pre?.lockedAt
          ? evaluateQbMappingLockDecision({
              userRole: req.user?.role,
              rawOverrideReason: req.body?.override_reason,
              defaultRoles: QB_ADMIN_ROLES,
              overrideRoles: QB_LOCK_OVERRIDE_ROLES,
            })
          : null;
        if (lockDecision?.kind === "reject") {
          res.status(lockDecision.status).json(lockDecision.body);
          return;
        }
        const overrideApplied = lockDecision?.kind === "proceed_with_override";
        const overrideReason =
          lockDecision?.kind === "proceed_with_override" ? lockDecision.reason : null;
        const [row] = await db
          .update(quickbooksVendorMappings)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(quickbooksVendorMappings.id, id))
          .returning();
        if (!row) {
          res.status(404).json({ error: "not_found", message: "Vendor mapping not found" });
          return;
        }
        logAuditFromReq(req, {
          entityType: "quickbooks_vendor_mapping",
          entityId: String(id),
          action: overrideApplied
            ? "quickbooks.vendor_mapping.unmap_with_override"
            : "quickbooks.vendor_mapping.unmap",
          source: "UI",
          changesJson: {
            qbVendorId: row.qbVendorId,
            counterpartyId: row.counterpartyId,
            ...(overrideApplied
              ? { lockOverridden: true, overrideApplied: true, overrideReason }
              : {}),
          },
        });
        res.json({
          ok: true,
          ...(overrideApplied
            ? { override_applied: true, override_reason: overrideReason }
            : {}),
        });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.vendor_mappings.delete", "quickbooks_vendor_mapping_delete_failed", "Failed to delete QuickBooks vendor mapping", err);
      }
    },
  );

  // ---------- Revenue reconciliation (Invoices ↔ revenue lines) ----------

  app.get(
    "/api/quickbooks/projects/:projectId/revenue-reconciliation",
    requireAuth,
    requirePermission("financial_integration", "view"),
    async (req, res) => {
      try {
        const projectId = Number(req.params.projectId);
        if (!Number.isFinite(projectId) || projectId <= 0) {
          res.status(400).json({ error: "bad_request", message: "Invalid projectId" });
          return;
        }
        const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
        const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
        const result = await runProjectRevenueReconciliation(projectId, { startDate, endDate });

        // W6: Surface QB freshness in revenue reconciliation response.
        let _freshness: { isStale: boolean; ageMs: number | null; warning: string | null } | undefined;
        try {
          const status = await getQuickBooksConnectionStatus();
          _freshness = {
            isStale: status.isStale,
            ageMs: status.ageMs,
            warning: status.isStale
              ? "QuickBooks data may be stale — reconciliation results could differ from current QuickBooks state."
              : null,
          };
        } catch { /* non-blocking */ }

        res.json({ ...result, _freshness });
      } catch (err) {
        notConnectedResponse(res, err);
      }
    },
  );

  app.post("/api/quickbooks/revenue-links", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
    try {
      const body = req.body ?? {};
      const revenueLineId = Number(body.revenueLineId ?? body.appEntityId);
      const projectId = body.projectId !== undefined && body.projectId !== null ? Number(body.projectId) : null;
      if (!Number.isFinite(revenueLineId) || revenueLineId <= 0) {
        res.status(400).json({ error: "bad_request", message: "revenueLineId is required" });
        return;
      }

      let invoiceSummary: QuickBooksInvoiceSummary | null = null;
      if (body.invoice && typeof body.invoice === "object") {
        invoiceSummary =
          typeof body.invoice.Id !== "undefined"
            ? invoiceRawToSummary(body.invoice)
            : (body.invoice as QuickBooksInvoiceSummary);
      }
      if (!invoiceSummary || !invoiceSummary.id) {
        res.status(400).json({ error: "bad_request", message: "invoice (with id) is required" });
        return;
      }

      const user = getEffectiveUser(req);
      try {
        const link = await confirmRevenueLineLink({
          projectId,
          revenueLineId,
          invoice: invoiceSummary,
          matchType: body.matchType ?? "manual",
          notes: body.notes ?? null,
          confirmedBy: user?.id ?? null,
        });
        logAuditFromReq(req, {
          entityType: "quickbooks_invoice_link",
          entityId: String(link.id),
          action: "quickbooks.link.confirm",
          source: "UI",
          changesJson: {
            appEntityType: "revenue_line",
            appEntityId: revenueLineId,
            qbEntityType: "invoice",
            qbEntityId: invoiceSummary.id,
            qbDocNumber: invoiceSummary.docNumber,
            qbAmount: invoiceSummary.totalAmount,
            projectId,
            matchType: body.matchType ?? "manual",
          },
        });
        res.status(201).json({ link });
      } catch (inner) {
        if (handleLinkConflict(res, inner)) {
          logAuditFromReq(req, {
            entityType: "quickbooks_invoice_link",
            entityId: `revenue_line:${revenueLineId}`,
            action: "quickbooks.link.conflict",
            source: "UI",
            changesJson: {
              appEntityType: "revenue_line",
              appEntityId: revenueLineId,
              qbEntityId: invoiceSummary.id,
              reason: (inner as QuickBooksLinkConflictError).reason,
            },
          });
          return;
        }
        throw inner;
      }
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.revenue_links.create", "quickbooks_revenue_link_failed", "Failed to create QuickBooks revenue link", err);
    }
  });

  app.get("/api/quickbooks/cost-lines/search", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const costLines = await searchCostLines(q, Number.isFinite(limit) ? limit : 50);
      res.json({ costLines });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.cost_lines.search", "quickbooks_search_failed", "QuickBooks cost-line search failed", err);
    }
  });

  app.get("/api/quickbooks/revenue-lines/search", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const revenueLines = await searchRevenueLines(q, Number.isFinite(limit) ? limit : 50);
      res.json({ revenueLines });
    } catch (err) {
      quickBooksServerFailure(res, "quickbooks.revenue_lines.search", "quickbooks_search_failed", "QuickBooks revenue-line search failed", err);
    }
  });

  // ===========================================================================
  // Task #30 — Admin-only fuzzy match + cascade.
  //
  // Four endpoints, all gated by requireAdmin (CEO_ADMIN / COO_ADMIN):
  //   POST /api/quickbooks/suggest-matches            → run the matcher
  //   POST /api/quickbooks/suggest-matches/preview    → dry-run cascade
  //   POST /api/quickbooks/suggest-matches/accept     → commit
  //   POST /api/quickbooks/mappings/:scope/:id/unlock → admin override
  //
  // Safety contract enforced by the cascade service:
  //   - Never mutates cos_realised, paid_date_confirmed, allocations.
  //   - Skips reconciled / locked rows, surfacing them in the preview.
  //   - Every accept writes audit + suggestion + cascade_run rows.
  // ===========================================================================

  // Scope is restricted to customer + vendor: those are the two primary
  // mapping tables that drive both the customer/vendor mappings AND, via
  // quickbooks_documents joins, the expense-invoice / incoming-invoice
  // link re-pointing. Adding scope='expense_invoice' / 'incoming_invoice'
  // as separate flows is tracked as a follow-up; we removed those values
  // from the enum to keep dead-end paths off the contract.
  const suggestMatchesBodySchema = z.object({
    scope: z.enum(["customer", "vendor"]),
    appEntityId: z.number().int().positive().optional(),
  });

  app.post(
    "/api/quickbooks/suggest-matches",
    requireAuth,
    requireAdmin,
    validateBody(suggestMatchesBodySchema),
    async (req, res) => {
      try {
        const { scope, appEntityId } = req.body as z.infer<typeof suggestMatchesBodySchema>;
        const status = await getQuickBooksConnectionStatus();
        if (!status?.realmId) {
          return res.status(409).json({ error: "quickbooks_not_connected" });
        }
        const qbRealmId = status.realmId;
        const userId = getEffectiveUser(req)?.id ?? null;

        let needleName = "";
        let appEntityLabel: string | null = null;
        let haystack: { id: string; name: string | null }[] = [];

        if (scope === "customer") {
          if (!appEntityId) return res.status(400).json({ error: "appEntityId (projectId) required" });
          const [project] = await db
            .select({ id: projectInfo.id, name: projectInfo.projectName })
            .from(projectInfo)
            .where(eq(projectInfo.id, appEntityId));
          if (!project) return res.status(404).json({ error: "project_not_found" });
          needleName = project.name ?? "";
          appEntityLabel = needleName;
          const customers: any = await getCustomers();
          haystack = (customers?.QueryResponse?.Customer ?? []).map((c: any) => ({
            id: String(c.Id),
            name: String(c.DisplayName ?? c.CompanyName ?? c.FullyQualifiedName ?? ""),
          }));
        } else if (scope === "vendor") {
          if (!appEntityId) return res.status(400).json({ error: "appEntityId (counterpartyId) required" });
          const [cp] = await db
            .select({ id: counterparties.id, name: counterparties.nameCanonical })
            .from(counterparties)
            .where(eq(counterparties.id, appEntityId));
          if (!cp) return res.status(404).json({ error: "counterparty_not_found" });
          needleName = cp.name ?? "";
          appEntityLabel = needleName;
          const vendors: any = await getVendors();
          haystack = (vendors?.QueryResponse?.Vendor ?? []).map((v: any) => ({
            id: String(v.Id),
            name: String(v.DisplayName ?? v.CompanyName ?? ""),
          }));
        } else {
          // Unreachable — Zod enum already restricts scope to
          // 'customer' | 'vendor'. Defensive guard only.
          return res.status(400).json({ error: "unsupported_scope" });
        }

        const candidates = rankCandidates(needleName, haystack, 5);
        const suggestion = await recordSuggestion({
          scope: scope as SuggestScope,
          qbRealmId,
          appEntityId: appEntityId ?? null,
          appEntityLabel,
          candidates,
          requestedBy: userId,
        });

        logAuditFromReq(req, {
          entityType: "qb_match_suggestion",
          entityId: String(suggestion.id),
          action: "suggest",
          changesJson: { scope, appEntityId, needleName, candidateCount: candidates.length },
          source: "SETTINGS",
        });

        res.json({ suggestion, candidates });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.suggest_matches", "suggest_matches_failed", "Failed to suggest QuickBooks matches", err);
      }
    },
  );

  const previewCascadeBody = z.object({
    suggestionId: z.number().int().positive(),
    candidateIndex: z.number().int().min(0),
  });

  app.post(
    "/api/quickbooks/suggest-matches/preview-cascade",
    requireAuth,
    requireAdmin,
    validateBody(previewCascadeBody),
    async (req, res) => {
      try {
        const { suggestionId, candidateIndex } = req.body as z.infer<typeof previewCascadeBody>;
        const userId = getEffectiveUser(req)?.id ?? null;

        const [suggestion] = await db
          .select()
          .from(quickbooksMatchSuggestions)
          .where(eq(quickbooksMatchSuggestions.id, suggestionId));
        if (!suggestion) return res.status(404).json({ error: "suggestion_not_found" });

        const candidates = (suggestion.candidates as MatchCandidateLite[]) ?? [];
        const chosen = candidates[candidateIndex];
        if (!chosen) return res.status(400).json({ error: "candidate_index_out_of_range" });

        let preview;
        let sourceEntityType: string;
        if (suggestion.scope === "customer") {
          if (!suggestion.appEntityId) return res.status(400).json({ error: "missing_app_entity_id" });
          preview = await previewCustomerCascade(
            suggestion.appEntityId,
            chosen.qbId,
            suggestion.qbRealmId,
          );
          sourceEntityType = "qb_customer_mapping";
        } else if (suggestion.scope === "vendor") {
          if (!suggestion.appEntityId) return res.status(400).json({ error: "missing_app_entity_id" });
          preview = await previewVendorCascade(
            suggestion.appEntityId,
            chosen.qbId,
            suggestion.qbRealmId,
          );
          sourceEntityType = "qb_vendor_mapping";
        } else {
          return res.status(400).json({ error: "unsupported_scope" });
        }

        const cascadeRun = await recordCascadePreview({
          suggestionId: suggestion.id,
          scope: suggestion.scope as SuggestScope,
          qbRealmId: suggestion.qbRealmId,
          sourceEntityType,
          sourceEntityId: suggestion.appEntityId ?? null,
          preview,
          triggeredBy: userId,
        });

        res.json({ cascadeRunId: cascadeRun.id, candidate: chosen, preview });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.suggest_matches.preview_cascade", "preview_cascade_failed", "Failed to preview QuickBooks cascade", err);
      }
    },
  );

  const acceptBody = z.object({
    suggestionId: z.number().int().positive(),
    cascadeRunId: z.number().int().positive(),
    candidateIndex: z.number().int().min(0),
  });

  app.post(
    "/api/quickbooks/suggest-matches/accept",
    requireAuth,
    requireAdmin,
    validateBody(acceptBody),
    async (req, res) => {
      try {
        const { suggestionId, cascadeRunId, candidateIndex } =
          req.body as z.infer<typeof acceptBody>;
        const userId = getEffectiveUser(req)?.id ?? null;

        const [suggestion] = await db
          .select()
          .from(quickbooksMatchSuggestions)
          .where(eq(quickbooksMatchSuggestions.id, suggestionId));
        if (!suggestion) return res.status(404).json({ error: "suggestion_not_found" });
        if (suggestion.acceptedAt) {
          return res.status(409).json({ error: "suggestion_already_accepted" });
        }

        const candidates = (suggestion.candidates as MatchCandidateLite[]) ?? [];
        const chosen = candidates[candidateIndex];
        if (!chosen) return res.status(400).json({ error: "candidate_index_out_of_range" });

        const [cascade] = await db
          .select()
          .from(quickbooksCascadeRuns)
          .where(eq(quickbooksCascadeRuns.id, cascadeRunId));
        if (!cascade) return res.status(404).json({ error: "cascade_run_not_found" });
        if (cascade.status !== "preview") {
          return res.status(409).json({ error: "cascade_already_committed_or_aborted" });
        }
        const preview = cascade.preview as unknown as {
          willUpdate: { linkId: number; reason: string }[];
          willSkipLocked: any[];
          willSkipReconciled: any[];
        };

        if (suggestion.scope === "customer") {
          const result = await commitCustomerCascade({
            req,
            suggestionId: suggestion.id,
            cascadeRunId: cascade.id,
            projectId: suggestion.appEntityId!,
            qbCustomerId: chosen.qbId,
            qbCustomerName: chosen.qbName,
            qbRealmId: suggestion.qbRealmId,
            confidence: chosen.confidence,
            preview,
            userId,
          });
          return res.json({ ok: true, ...result });
        }
        if (suggestion.scope === "vendor") {
          const [cp] = await db
            .select({ name: counterparties.nameCanonical })
            .from(counterparties)
            .where(eq(counterparties.id, suggestion.appEntityId!));
          const result = await commitVendorCascade({
            req,
            suggestionId: suggestion.id,
            cascadeRunId: cascade.id,
            counterpartyId: suggestion.appEntityId!,
            counterpartyName: cp?.name ?? null,
            qbVendorId: chosen.qbId,
            qbVendorName: chosen.qbName,
            qbRealmId: suggestion.qbRealmId,
            confidence: chosen.confidence,
            preview,
            userId,
          });
          return res.json({ ok: true, ...result });
        }
        return res.status(400).json({ error: "unsupported_scope" });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.suggest_matches.accept", "accept_cascade_failed", "Failed to accept QuickBooks cascade", err);
      }
    },
  );

  app.post(
    "/api/quickbooks/mappings/:scope/:id/unlock",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const scope = String(req.params.scope);
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "bad_id" });
      const userId = getEffectiveUser(req)?.id ?? null;
      try {
        let row;
        if (scope === "customer") {
          row = await unlockCustomerMapping(req, id, userId);
        } else if (scope === "vendor") {
          row = await unlockVendorMapping(req, id, userId);
        } else {
          return res.status(400).json({ error: "bad_scope" });
        }
        if (!row) return res.status(404).json({ error: "mapping_not_found" });
        res.json({ ok: true, mappingId: row.id });
      } catch (err) {
        quickBooksServerFailure(res, "quickbooks.mappings.unlock", "unlock_failed", "Failed to unlock QuickBooks mapping", err);
      }
    },
  );

  // Suppress unused-import false-positives — createOrUpdateLink is the shared
  // helper used by future endpoints (revenue-line reconciliation).
  void createOrUpdateLink;
}

// Local type used by the cascade endpoints to read suggestion candidates
// out of JSONB without importing the full MatchCandidate type.
type MatchCandidateLite = { qbId: string; qbName: string; confidence: number; reasons: string[] };
