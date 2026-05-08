import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { ncrReports, ncrAttachments, ncrComments, users, projectExecutionState } from "@shared/schema";
import { requireAuth, getEffectiveUser } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { recordAudit } from "./api/v2/services/audit-service";
import { requireAuthoriserFor } from "./middleware/requireAuthoriserFor";

/**
 * NCR state machine. Forward-only chain (`open → investigating →
 * corrective_action → verification → closed`) with one exit branch
 * `waived` reachable from any non-terminal state when an authorised
 * user records a waiver reason. § T3-2 (Plan v3) added the `waived`
 * branch — playbook § 5.10 implies authorised waivers are rare-but-
 * possible.
 */
const STATUS_ORDER = ["open", "investigating", "corrective_action", "verification", "closed"] as const;
const TERMINAL = new Set(["closed", "waived"]);

function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;
  if (to === "waived") return true; // waiver is reachable from any non-terminal state
  const fromIdx = STATUS_ORDER.indexOf(from as any);
  const toIdx = STATUS_ORDER.indexOf(to as any);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx === fromIdx + 1; // strict forward by one step
}

/**
 * Compatibility shim: pre-Plan-v3 callers (e.g., bootstrap, server boot)
 * may still invoke `ensureNcrTables()`. The canonical migration
 * `0059_ncr_reports_drizzle_canon.sql` now owns the schema. This export
 * is a no-op kept so existing imports do not break.
 */
export async function ensureNcrTables(): Promise<void> {
  return;
}

export function registerQualityNcrRoutes(app: Express) {
  // List
  app.get("/api/quality/ncrs", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const severity = req.query.severity ? String(req.query.severity) : null;
      const filters: any[] = [];
      if (status) filters.push(eq(ncrReports.status, status as any));
      if (severity) filters.push(eq(ncrReports.severity, severity as any));
      const where = filters.length > 0 ? and(...filters) : undefined;
      const rows = await db
        .select({
          ncr: ncrReports,
          assigneeName: users.name,
        })
        .from(ncrReports)
        .leftJoin(users, eq(users.id, ncrReports.assignedTo))
        .where(where)
        .orderBy(desc(ncrReports.updatedAt));
      const items = rows.map((r: { ncr: typeof ncrReports.$inferSelect; assigneeName: string | null }) => ({
        ...r.ncr,
        assigneeName: r.assigneeName,
      }));
      res.json({ items });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCRs:", err);
      res.status(500).json({ error: "Failed to fetch NCR reports" });
    }
  });

  // Create
  app.post("/api/quality/ncrs", requireAuth, requirePermission("quality", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const { project_id, assigned_to, title, description, severity, due_date, related_checklist_item_id, subcontractor_id } = req.body || {};
      if (!project_id || !title || !severity) {
        return res.status(400).json({ error: "project_id, title, severity required" });
      }
      // Capture the project's current phase at NCR-raise time — never mutated.
      const [exec] = await db
        .select({ phase: projectExecutionState.phase })
        .from(projectExecutionState)
        .where(eq(projectExecutionState.projectId, project_id))
        .limit(1);
      const [created] = await db.insert(ncrReports).values({
        projectId: project_id,
        phaseAtRaiseTime: exec?.phase ?? null,
        subcontractorId: subcontractor_id ?? null,
        relatedChecklistItemId: related_checklist_item_id ?? null,
        reportedBy: user!.id,
        assignedTo: assigned_to ?? null,
        title,
        description: description ?? null,
        severity,
        status: "open",
        dueDate: due_date ?? null,
      }).returning();
      logAuditFromReq(req, { entityType: "ncr_report", entityId: String(created.id), action: "create", changesJson: { title, severity, project_id, phaseAtRaiseTime: created.phaseAtRaiseTime } });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user?.id,
        entityType: "ncr_report",
        entityId: String(created.id),
        action: "CREATE_NCR",
        changesJson: { projectId: project_id, severity, status: "open", phaseAtRaiseTime: created.phaseAtRaiseTime },
      });
      res.status(201).json({ ok: true, id: created.id });
    } catch (err) {
      console.error("[QualityNCR] Failed to create NCR:", err);
      res.status(500).json({ error: "Failed to create NCR report" });
    }
  });

  // Get one
  app.get("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [ncr] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
      if (!ncr) return res.status(404).json({ error: "not_found" });
      const comments = await db
        .select({
          c: ncrComments,
          userName: users.name,
        })
        .from(ncrComments)
        .leftJoin(users, eq(users.id, ncrComments.userId))
        .where(eq(ncrComments.ncrId, id))
        .orderBy(ncrComments.createdAt);
      const attachments = await db
        .select()
        .from(ncrAttachments)
        .where(eq(ncrAttachments.ncrId, id))
        .orderBy(desc(ncrAttachments.createdAt));
      res.json({
        ncr,
        comments: comments.map((r: { c: typeof ncrComments.$inferSelect; userName: string | null }) => ({ ...r.c, userName: r.userName })),
        attachments,
      });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCR:", err);
      res.status(500).json({ error: "Failed to fetch NCR report" });
    }
  });

  // Update — non-waiver transitions. Waiver uses the dedicated route below.
  app.put("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [current] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
      if (!current) return res.status(404).json({ error: "not_found" });
      const next = req.body?.status ? String(req.body.status) : current.status;
      if (next === "waived") {
        return res.status(400).json({ error: "use_waiver_route", message: "Use POST /api/quality/ncrs/:id/waive to record a waiver." });
      }
      if (next !== current.status && !canTransition(current.status, next)) {
        return res.status(400).json({ error: "invalid_transition", message: `Cannot transition ${current.status} -> ${next}` });
      }
      const user = getEffectiveUser(req);
      const updates: any = {
        title: req.body?.title ?? current.title,
        description: req.body?.description ?? current.description,
        severity: req.body?.severity ?? current.severity,
        status: next as any,
        rootCause: req.body?.root_cause ?? current.rootCause,
        correctiveAction: req.body?.corrective_action ?? current.correctiveAction,
        preventiveAction: req.body?.preventive_action ?? current.preventiveAction,
        assignedTo: req.body?.assigned_to ?? current.assignedTo,
        dueDate: req.body?.due_date ?? current.dueDate,
        updatedAt: new Date(),
      };
      if (next === "closed" && current.status !== "closed") {
        updates.closedAt = new Date();
        updates.closedByUserId = user?.id ?? null;
      }
      await db.update(ncrReports).set(updates).where(eq(ncrReports.id, id));
      const transition = current.status !== next ? `${current.status} -> ${next}` : undefined;
      logAuditFromReq(req, { entityType: "ncr_report", entityId: String(id), action: "update", changesJson: { statusTransition: transition } });
      if (transition) {
        await recordAudit({
          actorRole: (user as any)?.role,
          userId: user?.id,
          entityType: "ncr_report",
          entityId: String(id),
          action: "TRANSITION_NCR_STATUS",
          changesJson: { fromStatus: current.status, toStatus: next, projectId: current.projectId },
        });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to update NCR:", err);
      res.status(500).json({ error: "Failed to update NCR report" });
    }
  });

  // Waiver — authorised override path. Captures reason + audit per § 0A.
  app.post(
    "/api/quality/ncrs/:id/waive",
    requireAuth,
    requirePermission("quality", "edit"),
    requireAuthoriserFor("quality"),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const [current] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
        if (!current) return res.status(404).json({ error: "not_found" });
        if (TERMINAL.has(current.status)) {
          return res.status(400).json({ error: "already_terminal", message: `NCR is already ${current.status}` });
        }
        const reason = req.authoriser!.reason;
        const user = getEffectiveUser(req);
        await db
          .update(ncrReports)
          .set({
            status: "waived" as any,
            waiverReason: reason,
            closedAt: new Date(),
            closedByUserId: user?.id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(ncrReports.id, id));
        logAuditFromReq(req, {
          entityType: "ncr_report",
          entityId: String(id),
          action: "waive",
          changesJson: { fromStatus: current.status, reason, override_applied: true },
        });
        await recordAudit({
          actorRole: req.authoriser!.role,
          userId: req.authoriser!.userId,
          entityType: "ncr_report",
          entityId: String(id),
          action: "WAIVE_NCR",
          changesJson: { fromStatus: current.status, projectId: current.projectId, reason },
        });
        res.json({ ok: true, override_applied: true });
      } catch (err) {
        console.error("[QualityNCR] Failed to waive NCR:", err);
        res.status(500).json({ error: "Failed to waive NCR report" });
      }
    },
  );

  // Delete
  app.delete("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "delete"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      // Children cascade via FK ON DELETE CASCADE.
      const [deleted] = await db.delete(ncrReports).where(eq(ncrReports.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: "not_found" });
      const user = getEffectiveUser(req);
      logAuditFromReq(req, { entityType: "ncr_report", entityId: String(id), action: "delete", changesJson: { description: "NCR deleted" } });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user?.id,
        entityType: "ncr_report",
        entityId: String(id),
        action: "DELETE_NCR",
        changesJson: { projectId: deleted.projectId },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to delete NCR:", err);
      res.status(500).json({ error: "Failed to delete NCR report" });
    }
  });

  // Comments
  app.post("/api/quality/ncrs/:id/comments", requireAuth, requirePermission("quality", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const id = Number(req.params.id);
      if (!user) return res.status(401).json({ error: "auth_required" });
      const comment = String(req.body?.comment ?? "").trim();
      if (!comment) return res.status(400).json({ error: "comment_required" });
      await db.insert(ncrComments).values({ ncrId: id, userId: user.id, comment });
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to add comment:", err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  // /api/quality/dashboard is owned by quality-routes.ts.
}
