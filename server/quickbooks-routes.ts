/**
 * QuickBooks Online integration routes.
 *
 * Exposes the OAuth2 flow (auth + callback), connection status,
 * and read-only data endpoints (company, invoices, customers,
 * vendors, bills, P&L). Data endpoints are gated by `requireAuth`;
 * the OAuth callback is intentionally NOT gated (Intuit redirects
 * the browser here after consent — verification is done via the
 * CSRF `state` param stored on the session).
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth, getEffectiveUser } from "./auth-context";
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
  createOrUpdateLink,
  fetchProjectLinks,
  listAllLinks,
  markCostLineRealised,
  runProjectCostReconciliation,
  searchCostLines,
  softDeleteLink,
  type QuickBooksBillSummary,
} from "./services/quickbooks-reconciliation-service";

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

  app.get("/api/quickbooks/auth", requireAuth, async (req, res) => {
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
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const realmId = typeof req.query.realmId === "string" ? req.query.realmId : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const error = typeof req.query.error === "string" ? req.query.error : "";

      if (error) {
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent(error)}`);
        return;
      }

      if (!code || !realmId || !state) {
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent("Missing code, realmId, or state")}`);
        return;
      }

      const expectedState = (req.session as SessionWithQbState)?.qbState;
      if (!expectedState || expectedState !== state) {
        res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent("Invalid CSRF state")}`);
        return;
      }

      // One-shot: clear the state once verified.
      delete (req.session as SessionWithQbState).qbState;

      await exchangeCodeForTokens(code, realmId);

      res.redirect(`/admin/quickbooks?quickbooks=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "QuickBooks callback failed";
      res.redirect(`/admin/quickbooks?quickbooks=error&message=${encodeURIComponent(message)}`);
    }
  });

  // ---------- Connection status ----------

  app.get("/api/quickbooks/status", requireAuth, async (_req, res) => {
    try {
      const status = await getQuickBooksConnectionStatus();
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load status";
      res.status(500).json({ error: "quickbooks_status_failed", message });
    }
  });

  app.post("/api/quickbooks/disconnect", requireAuth, async (_req, res) => {
    try {
      await disconnectQuickBooks();
      res.json({ connected: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect";
      res.status(500).json({ error: "quickbooks_disconnect_failed", message });
    }
  });

  // ---------- Data endpoints ----------

  app.get("/api/quickbooks/company", requireAuth, async (_req, res) => {
    try {
      const info = await getCompanyInfo();
      res.json(info);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/invoices", requireAuth, async (req, res) => {
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
      const data = await getInvoices(startDate, endDate);
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/customers", requireAuth, async (_req, res) => {
    try {
      const data = await getCustomers();
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/vendors", requireAuth, async (_req, res) => {
    try {
      const data = await getVendors();
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/bills", requireAuth, async (req, res) => {
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
      const data = await getBills(startDate, endDate);
      res.json(data);
    } catch (err) {
      notConnectedResponse(res, err);
    }
  });

  app.get("/api/quickbooks/reports/pnl", requireAuth, async (req, res) => {
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
        res.json(result);
      } catch (err) {
        notConnectedResponse(res, err);
      }
    },
  );

  app.get("/api/quickbooks/projects/:projectId/links", requireAuth, async (req, res) => {
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

  app.get("/api/quickbooks/links", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;
      const links = await listAllLinks(Number.isFinite(limit) ? limit : 500);
      res.json({ links });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list links";
      res.status(500).json({ error: "quickbooks_links_failed", message });
    }
  });

  app.post("/api/quickbooks/links", requireAuth, async (req, res) => {
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
      const link = await confirmCostLineLink({
        projectId,
        costLineId,
        bill: billSummary,
        matchType: body.matchType ?? "manual",
        notes: body.notes ?? null,
        confirmedBy: user?.id ?? null,
      });

      res.status(201).json({ link });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create link";
      res.status(500).json({ error: "quickbooks_link_failed", message });
    }
  });

  app.delete("/api/quickbooks/links/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid link id" });
        return;
      }
      await softDeleteLink(id);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete link";
      res.status(500).json({ error: "quickbooks_link_delete_failed", message });
    }
  });

  app.post("/api/quickbooks/cost-lines/:id/mark-realised", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "bad_request", message: "Invalid cost line id" });
        return;
      }
      const updated = await markCostLineRealised(id);
      if (!updated) {
        res.status(404).json({ error: "not_found", message: "Cost line not found" });
        return;
      }
      res.json({ costLine: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark realised";
      res.status(500).json({ error: "quickbooks_mark_realised_failed", message });
    }
  });

  app.get("/api/quickbooks/cost-lines/search", requireAuth, async (req, res) => {
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

  // Suppress unused-import false-positives — createOrUpdateLink is the shared
  // helper used by future endpoints (revenue-line reconciliation).
  void createOrUpdateLink;
}
