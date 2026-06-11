/**
 * Company-wide tracker-vs-QuickBooks reconciliation routes (R2). Read/compare
 * only (it NEVER writes back to QuickBooks or adjusts a tracker) + an on-demand
 * refresh + recon-ignore annotations. NO project dimension — see
 * qb-tracker-reconcile.ts and docs/finance-reconciliation.md.
 *
 *   GET    /api/finance/qb-recon/summary?grain=month|week|day → per-period REV/COS/GP
 *   GET    /api/finance/qb-recon/lines?status=&period=        → the worklist (ignored dropped)
 *   GET    /api/finance/qb-recon/ignores                      → suppressed differences (who/why)
 *   POST   /api/finance/qb-recon/ignore                       → accept a difference (financials:edit)
 *   DELETE /api/finance/qb-recon/ignore/:id                   → restore it (financials:edit)
 *   POST   /api/finance/qb-recon/refresh                      → recompute (financials:edit)
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { logAuditFromReq } from "../audit-logger";
import { db } from "../db";
import { parseIntParam } from "../lib/req-params";
import { sendFinanceError } from "../lib/api-error";
import { QbReconciliationOverridesRepository } from "../repositories/qb-reconciliation-overrides-repository";
import {
  activeLineIgnoreKeySet,
  filterOutIgnoredLines,
  buildMergedIgnoreViews,
  type LineIgnoreRow,
} from "../lib/finance/qb-recon-ignore-view";
import {
  getQbReconSummary,
  getQbReconLines,
  getActiveQbReconIgnores,
  refreshQbTrackerReconciliation,
  type PeriodGrain,
  type ReconLineStatus,
} from "../services/qb-tracker-reconcile";

const GRAINS: readonly PeriodGrain[] = ["day", "week", "month"];
const STATUSES: readonly ReconLineStatus[] = ["matched", "amount_variance", "tracker_only", "qb_only"];

const overridesRepo = new QbReconciliationOverridesRepository();

// G4 — accept a company-worklist difference. Keyed on the recon line identity
// (stream + normalized invoice number) so a "genuine timing" or known
// non-tracker doc drops out of the actionable worklist while staying audited.
const ignoreBodySchema = z.object({
  stream: z.enum(["COS", "REV"]),
  invoiceNoNorm: z.string().min(1).max(128),
  invoiceNoRaw: z.string().max(256).nullable().optional(),
  trackerAmountExVat: z.number().finite().nullable().optional(),
  qbAmountExVat: z.number().finite().nullable().optional(),
  reason: z.string().min(1).max(500),
});
const ignoreUndoBodySchema = z.object({ reason: z.string().min(1).max(500) });

export function registerQbReconRoutes(app: Express): void {
  // Per-period REV / COS / GP (GP = REV − COS each side), tracker vs QuickBooks.
  app.get(
    "/api/finance/qb-recon/summary",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const raw = String(req.query.grain ?? "month");
        const grain: PeriodGrain = (GRAINS as readonly string[]).includes(raw) ? (raw as PeriodGrain) : "month";
        const periods = await getQbReconSummary(db, grain);
        res.json({ generatedAt: new Date().toISOString(), grain, periods });
      } catch (err) {
        return sendFinanceError(res, "qb_recon_summary_failed", err);
      }
    },
  );

  // The worklist — filter by status and/or fiscal period. Lines accepted as a
  // recon-ignore drop out here (they stay on the /ignores audit list).
  app.get(
    "/api/finance/qb-recon/lines",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const rawStatus = String(req.query.status ?? "");
        const status = (STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ReconLineStatus) : undefined;
        const periodParam = req.query.period != null ? parseIntParam(String(req.query.period)) : undefined;
        const fiscalPeriodId = periodParam != null && Number.isInteger(periodParam) ? periodParam : undefined;
        const [lines, lineIgnores] = await Promise.all([
          getQbReconLines(db, { status, fiscalPeriodId }),
          overridesRepo.listActiveLineIgnores(),
        ]);
        const ignoredKeys = activeLineIgnoreKeySet(lineIgnores as LineIgnoreRow[]);
        const visible = filterOutIgnoredLines(lines, ignoredKeys);
        res.json({
          generatedAt: new Date().toISOString(),
          count: visible.length,
          ignoredCount: lines.length - visible.length,
          lines: visible,
        });
      } catch (err) {
        return sendFinanceError(res, "qb_recon_lines_failed", err);
      }
    },
  );

  // Active recon-ignores — the company worklist ignores (restorable) merged with
  // the legacy per-project tracker-gap ignores, surfaced with who/why so an
  // accepted difference is visible + audited, never silently dropped. Read-only.
  app.get(
    "/api/finance/qb-recon/ignores",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const [lineIgnores, docIgnores] = await Promise.all([
          overridesRepo.listActiveLineIgnores(),
          getActiveQbReconIgnores(db),
        ]);
        const ignores = buildMergedIgnoreViews(lineIgnores as LineIgnoreRow[], docIgnores);
        res.json({ generatedAt: new Date().toISOString(), count: ignores.length, ignores });
      } catch (err) {
        return sendFinanceError(res, "qb_recon_ignores_failed", err);
      }
    },
  );

  // Accept a company-worklist difference (e.g. genuine timing). Captures
  // who + why + when; the difference drops out of the worklist but stays on the
  // audit list and in audit_events. NEVER writes back to QuickBooks.
  app.post(
    "/api/finance/qb-recon/ignore",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(ignoreBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as z.infer<typeof ignoreBodySchema>;
        const user = getEffectiveUser(req);
        const created = await overridesRepo.createLineIgnore({
          stream: body.stream,
          invoiceNoNorm: body.invoiceNoNorm,
          invoiceNoRaw: body.invoiceNoRaw ?? null,
          trackerAmountExVat: body.trackerAmountExVat != null ? body.trackerAmountExVat.toFixed(2) : null,
          qbAmountExVat: body.qbAmountExVat != null ? body.qbAmountExVat.toFixed(2) : null,
          reason: body.reason,
          ignoredByUserId: user?.id ?? null,
          ignoredByName: user?.name ?? user?.email ?? null,
        });
        logAuditFromReq(req, {
          entityType: "qb_recon_line_ignore",
          entityId: String(created.id),
          action: "create",
          changesJson: {
            previous_state: null,
            new_state: {
              stream: body.stream,
              invoiceNoNorm: body.invoiceNoNorm,
              invoiceNoRaw: body.invoiceNoRaw ?? null,
              trackerAmountExVat: body.trackerAmountExVat ?? null,
              qbAmountExVat: body.qbAmountExVat ?? null,
            },
            reason: body.reason,
          },
        });
        res.json({ ok: true, ignore: created });
      } catch (err) {
        return sendFinanceError(res, "qb_recon_ignore_failed", err);
      }
    },
  );

  // Restore an accepted difference back into the worklist (soft-delete + audit).
  app.delete(
    "/api/finance/qb-recon/ignore/:id",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(ignoreUndoBodySchema),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(String(req.params.id));
        if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });
        const body = req.body as z.infer<typeof ignoreUndoBodySchema>;
        const prev = await overridesRepo.getLineIgnoreById(id);
        if (!prev || prev.deletedAt) return res.status(404).json({ error: "not_found" });
        await overridesRepo.softDeleteLineIgnore(id);
        logAuditFromReq(req, {
          entityType: "qb_recon_line_ignore",
          entityId: String(id),
          action: "delete",
          changesJson: {
            previous_state: {
              stream: prev.stream,
              invoiceNoNorm: prev.invoiceNoNorm,
              reason: prev.reason,
              ignoredByName: prev.ignoredByName,
            },
            new_state: null,
            reason: body.reason,
          },
        });
        res.json({ ok: true });
      } catch (err) {
        return sendFinanceError(res, "qb_recon_unignore_failed", err);
      }
    },
  );

  // On-demand recompute (the daily scheduler triggers this automatically).
  app.post(
    "/api/finance/qb-recon/refresh",
    requireAuth,
    requirePermission("financials", "edit"),
    async (_req: Request, res: Response) => {
      try {
        const summary = await refreshQbTrackerReconciliation(db);
        res.json({ refreshedAt: new Date().toISOString(), ...summary });
      } catch (err) {
        console.error("[qb-recon] refresh error:", err);
        res.status(500).json({ error: "qb_recon_refresh_failed" });
      }
    },
  );
}
