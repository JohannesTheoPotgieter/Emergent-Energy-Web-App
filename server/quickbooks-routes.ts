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
import { requireAuth } from "./auth-context";
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
}
