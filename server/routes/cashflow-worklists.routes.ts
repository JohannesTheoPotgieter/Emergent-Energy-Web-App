/**
 * Cashflow worklist read endpoints — Accounts Receivable, Accounts Payable, and
 * the past-dated missing-invoice worklist (AGENT_GUARDRAILS § 3B / S3 — GP4).
 *
 *   GET /api/weekly-cashflow/receivables       ?project=Name1,Name2
 *   GET /api/weekly-cashflow/payables          ?project=Name1,Name2
 *   GET /api/weekly-cashflow/missing-invoices  ?project=Name1,Name2
 *
 * Reporting / visibility only — there is no payment workflow here (procure-to-pay
 * is parked, S4). All three read the SAME canonical, snapshot-guarded line
 * population the cashflow surface uses (`FinanceWorklistRepository`), age on the
 * invoice-raised date (col T), and report ex-VAT. No finance formula, number, or
 * schema change — the frozen computation paths (S10) are untouched.
 *
 * Same gate as the cashflow grid: requireAuth + requirePermission('cashflow','view').
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { ApiError, serverError } from "../lib/api-error";
import { FinanceWorklistRepository } from "../repositories/finance-worklist-repository";

/** Parse a comma-separated `?project=` filter (mirrors the cashflow detail). */
function parseProjectFilter(raw: unknown): string[] | null {
  if (!raw) return null;
  const names = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

function wrap(err: unknown, message: string): never {
  if (err instanceof ApiError) throw err;
  const wrapped = serverError(message);
  (wrapped as unknown as { cause?: unknown }).cause = err;
  throw wrapped;
}

export function registerCashflowWorklistsRoutes(app: Express): void {
  const repo = new FinanceWorklistRepository();

  app.get(
    "/api/weekly-cashflow/receivables",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectNames = parseProjectFilter(req.query.project);
        res.json(await repo.getReceivables({ projectNames }));
      } catch (err) {
        wrap(err, "Failed to load receivables worklist");
      }
    },
  );

  app.get(
    "/api/weekly-cashflow/payables",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectNames = parseProjectFilter(req.query.project);
        res.json(await repo.getPayables({ projectNames }));
      } catch (err) {
        wrap(err, "Failed to load payables worklist");
      }
    },
  );

  app.get(
    "/api/weekly-cashflow/missing-invoices",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectNames = parseProjectFilter(req.query.project);
        res.json(await repo.getMissingInvoices({ projectNames }));
      } catch (err) {
        wrap(err, "Failed to load missing-invoice worklist");
      }
    },
  );
}
