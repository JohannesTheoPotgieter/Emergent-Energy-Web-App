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
import { requirePermission } from "./permission-middleware";
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
  upsertCustomerMapping,
  type QuickBooksBillSummary,
  type QuickBooksInvoiceSummary,
} from "./services/quickbooks-reconciliation-service";
import { recordIntegrationRun } from "./services/integration-health-service";
import { db } from "./db";
import { integrations, integrationRunEvents, type IntegrationRunEvent } from "@shared/schema";
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

function notConnectedResponse(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "QuickBooks error";
  if (/not connected/i.test(message)) {
    res.status(409).json({ error: "quickbooks_not_connected", message });
    return;
  }
  res.status(502).json({ error: "quickbooks_api_error", message });
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

      const url = getAuthorizationUrl(state);
      res.redirect(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start QuickBooks auth";
      res.status(500).json({ error: "quickbooks_auth_failed", message });
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

      const expectedState = (req.session as SessionWithQbState)?.qbState;

      // Diagnostic: understand why CSRF state check fails
      console.log(`[QuickBooks callback] Session ID: ${req.sessionID ?? "NONE"}`);
      console.log(`[QuickBooks callback] Session exists: ${!!req.session}`);
      console.log(`[QuickBooks callback] qbState on session: ${expectedState ? `"${expectedState.slice(0, 8)}..."` : "UNDEFINED"}`);
      console.log(`[QuickBooks callback] state from query:   ${state ? `"${state.slice(0, 8)}..."` : "EMPTY"}`);
      console.log(`[QuickBooks callback] Match: ${expectedState === state}`);
      console.log(`[QuickBooks callback] Session keys: ${Object.keys(req.session ?? {}).join(", ")}`);

      if (!expectedState || expectedState !== state) {
        logAuditFromReq(req, {
          entityType: "quickbooks_integration",
          entityId: "quickbooks",
          action: "quickbooks.oauth.failed",
          source: "SETTINGS",
          changesJson: { reason: "csrf_mismatch", hadSession: !!req.session, hadState: !!expectedState, stateFromQuery: !!state },
        });
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent("Invalid CSRF state")}`);
        return;
      }

      // One-shot: clear the state once verified.
      delete (req.session as SessionWithQbState).qbState;

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
      const message = err instanceof Error ? err.message : "QuickBooks callback failed";
      logAuditFromReq(req, {
        entityType: "quickbooks_integration",
        entityId: "quickbooks",
        action: "quickbooks.oauth.failed",
        source: "SETTINGS",
        changesJson: { reason: "exchange_failed", message },
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
      const message = err instanceof Error ? err.message : "Failed to load status";
      res.status(500).json({ error: "quickbooks_status_failed", message });
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
      res.status(500).json({ error: "quickbooks_disconnect_failed", message });
    }
  });

  // ---------- Sync Now (manual refresh) ----------
  //
  // Triggers a pull of bills, invoices, customers, vendors and P&L.
  // Logs the run to integration_run_events so the health tile and
  // sync log both update in real time.
  app.post(
    "/api/quickbooks/sync-now",
    requireAuth,
    requirePermission("financial_integration", "view"),
    async (req, res) => {
      const startedAt = new Date();
      const errors: string[] = [];
      let recordsProcessed = 0;

      const safeCall = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
        try {
          const result = await fn();
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${label}: ${message}`);
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
          errorDetail: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
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
        const message = err instanceof Error ? err.message : "Failed to load sync log";
        res.status(500).json({ error: "quickbooks_sync_log_failed", message });
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
      const message = err instanceof Error ? err.message : "Failed to fetch links";
      res.status(500).json({ error: "quickbooks_links_failed", message });
    }
  });

  // ---------- Global links (cross-project) ----------

  app.get("/api/quickbooks/links", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;
      const links = await listAllLinks(Number.isFinite(limit) ? limit : 500);
      res.json({ links });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list links";
      res.status(500).json({ error: "quickbooks_links_failed", message });
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
        res.status(201).json({ link });
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
      const message = err instanceof Error ? err.message : "Failed to create link";
      res.status(500).json({ error: "quickbooks_link_failed", message });
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
          return sendError(res, new ApiError(503, "quickbooks_unavailable", err.message));
        }
        if (err instanceof QuickBooksBillNotFoundError) {
          return sendError(res, new ApiError(404, "quickbooks_bill_not_found", err.message));
        }
        if (err instanceof Error && /Over-assignment blocked/i.test(err.message)) {
          return sendError(res, conflict(err.message));
        }
        logApiError("quickbooks.cost_allocation.bulk_assign", err);
        return sendError(res, serverError("Failed to save QuickBooks cost allocations."));
      }
    },
  );

  app.delete("/api/quickbooks/links/:id", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
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
        },
      });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete link";
      res.status(500).json({ error: "quickbooks_link_delete_failed", message });
    }
  });

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
      const message = err instanceof Error ? err.message : "Failed to load mappings";
      res.status(500).json({ error: "quickbooks_mappings_failed", message });
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
        const message = err instanceof Error ? err.message : "Failed to load mapping";
        res.status(500).json({ error: "quickbooks_mapping_failed", message });
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
        action: "quickbooks.mapping.upsert",
        source: "UI",
        changesJson: {
          projectId,
          clientId: mapping.clientId,
          qbCustomerId: mapping.qbCustomerId,
          qbCustomerName: mapping.qbCustomerName,
          qbRealmId: mapping.qbRealmId,
        },
      });
      res.status(201).json({ mapping });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save mapping";
      res.status(500).json({ error: "quickbooks_mapping_save_failed", message });
    }
  });

  app.delete("/api/quickbooks/customer-mappings/:id", requireAuth, requirePermission("financials", "edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid mapping id" });
        return;
      }
      const previous = await softDeleteCustomerMapping(id);
      if (!previous) {
        res.status(404).json({ error: "not_found", message: "Mapping not found" });
        return;
      }
      logAuditFromReq(req, {
        entityType: "quickbooks_customer_mapping",
        entityId: String(id),
        action: "quickbooks.mapping.unmap",
        source: "UI",
        changesJson: {
          projectId: previous.projectId,
          clientId: previous.clientId,
          qbCustomerId: previous.qbCustomerId,
          qbCustomerName: previous.qbCustomerName,
          qbRealmId: previous.qbRealmId,
        },
      });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete mapping";
      res.status(500).json({ error: "quickbooks_mapping_delete_failed", message });
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
        const message = err instanceof Error ? err.message : "Failed to load vendor mappings";
        res.status(500).json({ error: "quickbooks_vendor_mappings_failed", message });
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
          action: existing ? "quickbooks.vendor_mapping.update" : "quickbooks.vendor_mapping.create",
          source: "UI",
          changesJson: {
            qbVendorId,
            qbVendorName,
            counterpartyId,
            counterpartyName,
          },
        });

        res.json({ mapping: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save vendor mapping";
        res.status(500).json({ error: "quickbooks_vendor_mapping_save_failed", message });
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
          action: "quickbooks.vendor_mapping.unmap",
          source: "UI",
          changesJson: {
            qbVendorId: row.qbVendorId,
            counterpartyId: row.counterpartyId,
          },
        });
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete vendor mapping";
        res.status(500).json({ error: "quickbooks_vendor_mapping_delete_failed", message });
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
      const message = err instanceof Error ? err.message : "Failed to create link";
      res.status(500).json({ error: "quickbooks_revenue_link_failed", message });
    }
  });

  app.get("/api/quickbooks/cost-lines/search", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const costLines = await searchCostLines(q, Number.isFinite(limit) ? limit : 50);
      res.json({ costLines });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      res.status(500).json({ error: "quickbooks_search_failed", message });
    }
  });

  app.get("/api/quickbooks/revenue-lines/search", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const revenueLines = await searchRevenueLines(q, Number.isFinite(limit) ? limit : 50);
      res.json({ revenueLines });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      res.status(500).json({ error: "quickbooks_search_failed", message });
    }
  });

  // Suppress unused-import false-positives — createOrUpdateLink is the shared
  // helper used by future endpoints (revenue-line reconciliation).
  void createOrUpdateLink;
}
