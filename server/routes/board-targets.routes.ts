/**
 * Board finance-target routes.
 *
 * Endpoints:
 *   GET  /api/board-targets            — every finance viewer: the current board
 *                                        FY revenue target + target margin % (read
 *                                        by the Finance Home Revenue KPI). Display
 *                                        comparison only — NOT a finance computation.
 *   PUT  /api/admin/board-targets/:fy  — allowlisted board admins set/clear a FY
 *                                        target. Every change is audited
 *                                        (audit_events, source SETTINGS) with
 *                                        who / when / value + reason.
 *
 * Auth: signed-in finance viewer for the GET; COO / CEO / CFO for the PUT.
 * These endpoints touch NONE of the frozen finance computation paths.
 */
import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { requireRole } from "../middleware/requireRole";
import { boardTargetsRepository } from "../repositories/board-targets.repository";
import { logAuditFromReq } from "../audit-logger";
import { badRequest } from "../lib/api-error";

// Board / finance admins allowed to set the target.
const BOARD_TARGET_ROLES = ["COO_ADMIN", "CEO_ADMIN", "CFO"] as const;

const FY_MIN = 2000;
const FY_MAX = 2100;

// A target value is optional (null clears it). Revenue is Rand ex-VAT; margin is
// a percentage 0–100. reason is a short justification captured to the audit log.
const upsertSchema = z.object({
  revenueTarget: z.number().finite().nonnegative().nullable().optional(),
  targetMarginPct: z.number().finite().min(0).max(100).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export function registerBoardTargetsRoutes(app: Express): void {
  // Finance viewers read the target so the Revenue KPI can compare against it.
  app.get(
    "/api/board-targets",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req, res) => {
      const targets = await boardTargetsRepository.getAll();
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json({ targets });
    },
  );

  app.put(
    "/api/admin/board-targets/:fy",
    requireAuth,
    requireRole([...BOARD_TARGET_ROLES]),
    async (req, res) => {
      const fy = Number.parseInt(String(req.params.fy), 10);
      if (!Number.isInteger(fy) || fy < FY_MIN || fy > FY_MAX) {
        throw badRequest("fy must be a fiscal year (e.g. 2026)");
      }

      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("revenueTarget/targetMarginPct must be numbers (or null); reason ≤ 500 chars");
      }

      const before = await boardTargetsRepository.getByFy(fy);
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      const next = {
        revenueTarget: parsed.data.revenueTarget ?? null,
        targetMarginPct: parsed.data.targetMarginPct ?? null,
        reason: parsed.data.reason ?? null,
        updatedByUserId: userId,
      };

      const saved = await boardTargetsRepository.upsert(fy, next);

      // Full who/when/value history lives here — the table only keeps the latest.
      logAuditFromReq(req, {
        entityType: "board_finance_target",
        entityId: `FY${fy}`,
        action: "set_board_finance_target",
        source: "SETTINGS",
        changesJson: {
          before: before
            ? { revenueTarget: before.revenueTarget, targetMarginPct: before.targetMarginPct }
            : null,
          after: { revenueTarget: saved.revenueTarget, targetMarginPct: saved.targetMarginPct },
          reason: next.reason,
        },
      });

      res.json({ ok: true, target: saved });
    },
  );
}
