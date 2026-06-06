/**
 * COS line review — the weekly finance-meeting line actions, in-app.
 *
 *   GET  /api/cos-line-review
 *        ?projectIds=1,2&fyStart=YYYY-MM-DD&fyEnd=YYYY-MM-DD&flaggedOnly=true
 *        Read-only. Returns every § 3.3 cost line with computed-on-read
 *        integrity flags (R2 allocation-missing / R3 invoice↔PO mismatch /
 *        R4 >=8x category-median anomaly). Flags are advisory metadata — they
 *        change NO reported figure.
 *
 *   POST /api/cos-line-review/:costLineId/move-period      { targetMonth, reason }
 *   POST /api/cos-line-review/:costLineId/set-invoice-date { invoiceDate, reason }
 *   POST /api/cos-line-review/:costLineId/clear-override   { reason }
 *   POST /api/cos-line-review/:costLineId/remove           { reason }
 *
 * The three date actions write the recognition-date OVERRIDE on the parent cost
 * line (the human-corrected invoice-raised date). The § 3.3 read path buckets
 * COS + revenue on `recognitionDateOverride ?? invoiceDate`, so the line lands
 * in the chosen month WITHOUT mutating the imported value — a re-import refreshes
 * invoice_date but the override still wins (R6). "remove" soft-closes the line.
 *
 * Every write is:
 *   • period-lock guarded on BOTH the source and target months (only
 *     COO / CFO / CEO may move across a locked period, and only with a reason),
 *   • audited (audit_events), and
 *   • flagged as a manual edit so Smart Import's conflict engine won't clobber it.
 *
 * No finance calculation is changed here: recognition stays on the invoice-raised
 * date (§ 3.3); this only decides WHICH invoice-raised date, with an audit trail.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";

import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";
import { FinanceExpenseEngineRepository } from "../repositories/finance-expense-engine-repository";
import { guardCosPeriodLock } from "../lib/finance/period-lock-guard";
import { recordManualEditFlag } from "../lib/manual-edit-flag";
import { logAuditFromReq } from "../audit-logger";
import {
  computeCosLineFlags,
  type CosLineFlagInput,
} from "../lib/finance/cos-line-flags";
import {
  cosLineReviewAffectedDates,
  type CosLineReviewAction,
} from "../lib/finance/cos-line-review-dates";

const financeLines = new FinanceLineLevelRepository();
const expenseRepo = new FinanceExpenseEngineRepository();

const REASON_MIN = 3;
const reasonField = z.string().trim().min(REASON_MIN, "A reason is required");

const movePeriodSchema = z.object({
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/, "targetMonth must be YYYY-MM"),
  reason: reasonField,
});
const setInvoiceDateSchema = z.object({
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invoiceDate must be YYYY-MM-DD"),
  reason: reasonField,
});
const reasonOnlySchema = z.object({ reason: reasonField });

type ReqUser = { id?: number; name?: string; role?: string } | undefined;

/**
 * Shared write path for the three date actions (move / set / clear). Writes the
 * recognition-date override after a both-periods lock check; null clears it.
 */
async function writeRecognitionOverride(
  req: Request,
  res: Response,
  costLineId: number,
  action: Exclude<CosLineReviewAction, "remove">,
  newOverride: string | null,
  reason: string,
): Promise<void> {
  const snapshot = await expenseRepo.getCostLineForLockCheck(costLineId);
  if (!snapshot) {
    res.status(404).json({ error: "Cost line not found in canonical cost lines" });
    return;
  }

  const sourceRecognition =
    snapshot.recognitionDateOverride || snapshot.invoiceDate || null;

  // Single reason covers both the action audit and any locked-period override.
  (req.body as Record<string, unknown>).lockOverrideReason = reason;

  // Lock-guard BOTH the source and target months (the pure matrix is unit-pinned).
  const blocked = await guardCosPeriodLock(req, res, {
    effectiveDates: cosLineReviewAffectedDates(action, snapshot, newOverride),
    surface: "COS line review",
    entityType: "normalized_cost_line",
    entityId: String(costLineId),
    projectName: snapshot.projectName,
  });
  if (blocked) return;

  const user = req.user as ReqUser;
  const now = new Date();
  const updated = await expenseRepo.updateCostLineRecognitionDateOverride(costLineId, {
    recognitionDateOverride: newOverride,
    recognitionDateOverrideReason: newOverride ? reason : null,
    recognitionDateOverrideBy: newOverride ? user?.id ?? null : null,
    recognitionDateOverrideAt: newOverride ? now : null,
  });
  if (!updated) {
    res.status(404).json({ error: "Cost line not found in canonical cost lines" });
    return;
  }

  await recordManualEditFlag({
    entityType: "normalized_cost_line",
    entityId: costLineId,
    fieldName: "recognitionDateOverride",
    editedByUserId: user?.id,
    editedByName: user?.name,
  });

  logAuditFromReq(req, {
    entityType: "normalized_cost_line",
    entityId: String(costLineId),
    action: `cos.line.${action}`,
    projectName: snapshot.projectName ?? undefined,
    changesJson: {
      reason,
      from: sourceRecognition,
      to: newOverride,
      importedInvoiceDate: snapshot.invoiceDate,
    },
  });

  const effective = updated.recognitionDateOverride ?? updated.invoiceDate ?? null;
  res.json({
    ok: true,
    costLineId,
    recognitionDateOverride: updated.recognitionDateOverride ?? null,
    recognitionMonth: effective ? String(effective).slice(0, 7) : null,
  });
}

function parseCostLineId(req: Request, res: Response): number | null {
  const id = Number(req.params.costLineId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid costLineId" });
    return null;
  }
  return id;
}

export function registerCosLineReviewRoutes(app: Express): void {
  // ── R2 / R3 / R4 — read-only integrity flags ──
  app.get(
    "/api/cos-line-review",
    requireAuth,
    requirePermission("cos", "view"),
    async (req: Request, res: Response) => {
      try {
        const fyStart =
          typeof req.query.fyStart === "string" ? req.query.fyStart : undefined;
        const fyEnd =
          typeof req.query.fyEnd === "string" ? req.query.fyEnd : undefined;
        const flaggedOnly = req.query.flaggedOnly === "true";

        // Project scope: explicit ?projectIds, else every project with active
        // cost lines. The name map comes from the same rows (cost lines carry
        // projectName), avoiding a projectInfo join.
        const projectNameById = new Map<number, string>();
        let projectIds: number[];
        const projectIdsParam =
          typeof req.query.projectIds === "string" ? req.query.projectIds : "";
        const explicit = projectIdsParam
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);

        const projRows = await expenseRepo.listActiveCostLineProjects();
        for (const r of projRows) {
          if (r.projectId == null) continue;
          projectNameById.set(
            r.projectId,
            (r.projectName ?? "").replace(/_Tracker$/i, ""),
          );
        }
        projectIds = explicit.length > 0 ? explicit : [...projectNameById.keys()];

        if (projectIds.length === 0) {
          return res.json({
            lines: [],
            summary: { total: 0, flagged: 0, allocationMissing: 0, poMismatch: 0, anomaly: 0 },
          });
        }

        const [lines, poTotals] = await Promise.all([
          financeLines.getPortfolioFinanceLines(projectIds, { fyStart, fyEnd }),
          expenseRepo.listPurchaseOrderTotalsByProject(projectIds),
        ]);

        const flagInputs: CosLineFlagInput[] = lines.map((l) => ({
          lineId: l.lineId,
          projectId: l.projectId,
          categoryAllocationId: l.categoryAllocationId,
          actualTotal: l.actualTotal,
          poNumber: l.poNumber,
          derivationWarning: l.derivationWarning,
        }));
        const flags = computeCosLineFlags(flagInputs, poTotals);
        const flagsByLineId = new Map(flags.map((f) => [f.lineId, f]));

        const rows = lines.map((l) => {
          const f = flagsByLineId.get(l.lineId)!;
          return {
            lineId: l.lineId,
            costLineId: l.parentLineId,
            projectId: l.projectId,
            projectName: l.projectId != null ? projectNameById.get(l.projectId) ?? null : null,
            categoryName: l.categoryName,
            descriptionOfWork: l.descriptionOfWork,
            actualTotal: l.actualTotal,
            perLineRevenue: l.perLineRevenue,
            perLineGp: l.perLineGp,
            poNumber: l.poNumber,
            bucket: l.bucket,
            recognitionMonth: l.recognitionMonth,
            invoiceRaisedDate: l.invoiceRaisedDate,
            recognitionDateOverride: l.recognitionDateOverride,
            flags: f,
          };
        });

        const result = flaggedOnly ? rows.filter((r) => r.flags.flagged) : rows;
        const summary = {
          total: rows.length,
          flagged: rows.filter((r) => r.flags.flagged).length,
          allocationMissing: rows.filter((r) => r.flags.allocationMissing).length,
          poMismatch: rows.filter((r) => r.flags.poMismatch).length,
          anomaly: rows.filter((r) => r.flags.anomaly).length,
        };
        return res.json({ lines: result, summary });
      } catch (err) {
        console.error("[cos-line-review] read failed:", err);
        return res.status(500).json({ error: "Failed to load COS line review" });
      }
    },
  );

  // ── R1 — move period (change the recognition month) ──
  app.post(
    "/api/cos-line-review/:costLineId/move-period",
    requireAuth,
    requirePermission("cos", "edit"),
    validateBody(movePeriodSchema),
    async (req: Request, res: Response) => {
      try {
        const costLineId = parseCostLineId(req, res);
        if (costLineId == null) return;
        const { targetMonth, reason } = req.body as z.infer<typeof movePeriodSchema>;
        // Recognition buckets by YYYY-MM; first-of-month is a stable, explicit
        // anchor for the chosen month.
        await writeRecognitionOverride(
          req,
          res,
          costLineId,
          "move_period",
          `${targetMonth}-01`,
          reason,
        );
      } catch (err) {
        console.error("[cos-line-review] move-period failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to move period" });
      }
    },
  );

  // ── R1 — set invoice date (exact recognition date) ──
  app.post(
    "/api/cos-line-review/:costLineId/set-invoice-date",
    requireAuth,
    requirePermission("cos", "edit"),
    validateBody(setInvoiceDateSchema),
    async (req: Request, res: Response) => {
      try {
        const costLineId = parseCostLineId(req, res);
        if (costLineId == null) return;
        const { invoiceDate, reason } = req.body as z.infer<typeof setInvoiceDateSchema>;
        await writeRecognitionOverride(
          req,
          res,
          costLineId,
          "set_invoice_date",
          invoiceDate,
          reason,
        );
      } catch (err) {
        console.error("[cos-line-review] set-invoice-date failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to set invoice date" });
      }
    },
  );

  // ── R1 — clear override (undo a move, back to the imported invoice date) ──
  app.post(
    "/api/cos-line-review/:costLineId/clear-override",
    requireAuth,
    requirePermission("cos", "edit"),
    validateBody(reasonOnlySchema),
    async (req: Request, res: Response) => {
      try {
        const costLineId = parseCostLineId(req, res);
        if (costLineId == null) return;
        const { reason } = req.body as z.infer<typeof reasonOnlySchema>;
        await writeRecognitionOverride(
          req,
          res,
          costLineId,
          "clear_override",
          null,
          reason,
        );
      } catch (err) {
        console.error("[cos-line-review] clear-override failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to clear override" });
      }
    },
  );

  // ── R1 — remove (soft-close the line) ──
  app.post(
    "/api/cos-line-review/:costLineId/remove",
    requireAuth,
    requirePermission("cos", "delete"),
    validateBody(reasonOnlySchema),
    async (req: Request, res: Response) => {
      try {
        const costLineId = parseCostLineId(req, res);
        if (costLineId == null) return;
        const { reason } = req.body as z.infer<typeof reasonOnlySchema>;

        const snapshot = await expenseRepo.getCostLineForLockCheck(costLineId);
        if (!snapshot) {
          return res.status(404).json({ error: "Cost line not found in canonical cost lines" });
        }
        const recognition =
          snapshot.recognitionDateOverride || snapshot.invoiceDate || null;
        (req.body as Record<string, unknown>).lockOverrideReason = reason;

        const blocked = await guardCosPeriodLock(req, res, {
          effectiveDates: cosLineReviewAffectedDates("remove", snapshot, null),
          surface: "COS line review (remove)",
          entityType: "normalized_cost_line",
          entityId: String(costLineId),
          projectName: snapshot.projectName,
        });
        if (blocked) return;

        const user = req.user as ReqUser;
        const removed = await expenseRepo.softRemoveCostLine(costLineId);
        if (!removed) {
          return res.status(404).json({ error: "Cost line not found in canonical cost lines" });
        }

        await recordManualEditFlag({
          entityType: "normalized_cost_line",
          entityId: costLineId,
          fieldName: "removed",
          editedByUserId: user?.id,
          editedByName: user?.name,
        });
        logAuditFromReq(req, {
          entityType: "normalized_cost_line",
          entityId: String(costLineId),
          action: "cos.line.remove",
          projectName: snapshot.projectName ?? undefined,
          changesJson: { reason, recognitionDate: recognition },
        });
        return res.json({ ok: true, costLineId, removed: true });
      } catch (err) {
        console.error("[cos-line-review] remove failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to remove cost line" });
      }
    },
  );
}
