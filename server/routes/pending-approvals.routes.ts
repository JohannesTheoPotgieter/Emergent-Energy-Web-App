import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../departments/shared-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  approvePending,
  listPendingApprovals,
  rejectPending,
  summarizePendingApprovals,
} from "../services/pending-approvals-service";
import { PENDING_APPROVAL_KINDS, PENDING_APPROVAL_STATUSES } from "@shared/schema";

// Roles allowed to approve / reject. Keep tight; anyone with `view` permission
// can list to monitor the queue, but only these roles can release.
const APPROVER_ROLES = ["ADMIN", "CCO", "CFO", "DIRECTOR", "PROJECT_DEVELOPER"];

export function registerPendingApprovalRoutes(app: Express) {
  app.get("/api/pending-approvals", requireAuth, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" && (PENDING_APPROVAL_STATUSES as readonly string[]).includes(req.query.status)
        ? (req.query.status as any)
        : "pending";
      const kind = typeof req.query.kind === "string" && (PENDING_APPROVAL_KINDS as readonly string[]).includes(req.query.kind)
        ? (req.query.kind as any)
        : undefined;
      const rows = await listPendingApprovals({ status, kind });
      const summary = await summarizePendingApprovals();
      res.json({ rows, summary });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to list pending approvals" });
    }
  });

  const decideSchema = z.object({ reason: z.string().max(500).optional() });

  app.post(
    "/api/pending-approvals/:id/approve",
    requireAuth,
    requireRole(...APPROVER_ROLES),
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "auth required" });
      try {
        const row = await approvePending(id, userId);
        logAuditFromReq(req, {
          entityType: "pending_approval",
          entityId: String(id),
          action: row.status === "approved" ? "approve" : "approve_failed",
          changesJson: { kind: row.kind, appliedRecordId: row.appliedRecordId, applyError: row.applyError },
        });
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ error: err?.message ?? "approve failed" });
      }
    },
  );

  app.post(
    "/api/pending-approvals/:id/reject",
    requireAuth,
    requireRole(...APPROVER_ROLES),
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "auth required" });
      const parsed = decideSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid body" });
      try {
        const row = await rejectPending(id, userId, parsed.data.reason ?? null);
        logAuditFromReq(req, {
          entityType: "pending_approval",
          entityId: String(id),
          action: "reject",
          changesJson: { kind: row.kind, reason: row.rejectionReason },
        });
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ error: err?.message ?? "reject failed" });
      }
    },
  );
}
