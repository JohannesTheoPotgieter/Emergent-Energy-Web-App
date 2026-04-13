import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, sql, isNull, and } from "drizzle-orm";
import { changeRequests, approvals, projectAccess } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { createVoApproval } from "./services/approval-service";
import { z } from "zod";

const VALID_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented', 'closed'] as const;

const createChangeRequestSchema = z.object({
  projectId: z.number({ required_error: "projectId is required" }),
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  changeType: z.enum(['scope', 'cost', 'schedule', 'technical', 'commercial'], { required_error: "changeType is required" }),
  ownerUserId: z.number().optional(),
  impactSummary: z.string().optional(),
  costImpact: z.string().optional(),
  scheduleImpactDays: z.number().optional(),
  cause: z.string().optional(),
  clientLinked: z.boolean().optional(),
  revenueImpact: z.string().optional(),
  cosImpact: z.string().optional(),
  marginImpact: z.string().optional(),
  evidenceLink: z.string().optional(),
});

const updateChangeRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  changeType: z.enum(['scope', 'cost', 'schedule', 'technical', 'commercial']).optional(),
  ownerUserId: z.number().optional(),
  impactSummary: z.string().optional(),
  costImpact: z.string().optional(),
  scheduleImpactDays: z.number().optional(),
  status: z.enum(VALID_STATUSES).optional(),
  cause: z.string().optional(),
  clientLinked: z.boolean().optional(),
  revenueImpact: z.string().optional(),
  cosImpact: z.string().optional(),
  marginImpact: z.string().optional(),
  evidenceLink: z.string().optional(),
  finalDecision: z.string().optional(),
});
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['implemented', 'closed'],
  rejected: ['draft', 'closed'],
  implemented: ['closed'],
  closed: [],
};

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

export function registerChangeControlRoutes(app: Express): void {
  app.get("/api/change-requests/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const rows = await db.execute(sql.raw(`
        SELECT cr.*,
          u1.name as requested_by_name,
          u2.name as owner_name,
          pi.project_name
        FROM change_requests cr
        LEFT JOIN users u1 ON cr.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON cr.owner_user_id = u2.id
        LEFT JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.project_id = ${projectId} AND cr.deleted_at IS NULL
        ORDER BY cr.created_at DESC
      `));
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ChangeControl] List error:", message);
      res.status(500).json({ error: "Failed to fetch change requests" });
    }
  });

  app.get("/api/change-requests/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cr.*, u1.name as requested_by_name, u2.name as owner_name, pi.project_name
        FROM change_requests cr
        LEFT JOIN users u1 ON cr.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON cr.owner_user_id = u2.id
        LEFT JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.id = ${id}
      `));
      const items = rowsFromResult(rows);
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch change request" });
    }
  });

  app.post("/api/change-requests", jwtAuth, requireAuth, requirePermission("projects", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const parsed = createChangeRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      const { projectId, title, description, changeType, ownerUserId, impactSummary, costImpact, scheduleImpactDays,
        cause, clientLinked, revenueImpact, cosImpact, marginImpact, evidenceLink,
      } = parsed.data;

      const result = await db.insert(changeRequests).values({
        projectId,
        title,
        description: description || null,
        changeType,
        requestedByUserId: user?.id,
        ownerUserId: ownerUserId || null,
        impactSummary: impactSummary || null,
        costImpact: costImpact || null,
        scheduleImpact: scheduleImpactDays || null,
        status: 'draft',
        // B6: enriched fields
        cause: cause || null,
        clientLinked: clientLinked ?? false,
        revenueImpact: revenueImpact || null,
        cosImpact: cosImpact || null,
        marginImpact: marginImpact || null,
        evidenceLink: evidenceLink || null,
      }).returning();

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(result[0].id),
        action: "create",
        changesJson: { title, changeType, projectId },
      });

      const actor = actorFromReq(req);
      await createProjectEvent({
        projectId: result[0].projectId,
        eventType: "change.created",
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        sourceEntityType: "change_requests",
        sourceEntityId: String(result[0].id),
        summary: `Change request created: ${result[0].title}`,
        details: { changeType: result[0].changeType, status: result[0].status },
        idempotencyKey: `change-created:${result[0].id}`,
      });

      res.status(201).json(result[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ChangeControl] Create error:", message);
      res.status(500).json({ error: "Failed to create change request" });
    }
  });

  app.patch("/api/change-requests/:id", jwtAuth, requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const parsed = updateChangeRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      const { title, description, changeType, ownerUserId, impactSummary, costImpact, scheduleImpactDays, status,
        cause, clientLinked, revenueImpact } = parsed.data;

      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (changeType !== undefined) updates.changeType = changeType;
      if (ownerUserId !== undefined) updates.ownerUserId = ownerUserId;
      if (impactSummary !== undefined) updates.impactSummary = impactSummary;
      if (costImpact !== undefined) updates.costImpact = costImpact;
      if (scheduleImpactDays !== undefined) updates.scheduleImpact = scheduleImpactDays;

      if (cause !== undefined) updates.cause = cause;
      if (clientLinked !== undefined) updates.clientLinked = clientLinked;
      if (revenueImpact !== undefined) updates.revenueImpact = revenueImpact;
      if (parsed.data.cosImpact !== undefined) updates.cosImpact = parsed.data.cosImpact;
      if (parsed.data.marginImpact !== undefined) updates.marginImpact = parsed.data.marginImpact;
      if (parsed.data.evidenceLink !== undefined) updates.evidenceLink = parsed.data.evidenceLink;
      if (parsed.data.finalDecision !== undefined) updates.finalDecision = parsed.data.finalDecision;

      if (status !== undefined && status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${status}` });
        }
        updates.status = status;

        if (status === 'submitted') {
          try {
            const user = getEffectiveUser(req);
            // B8: Use universal approval service with VO-specific metadata
          const revImpact = Number(old.revenueImpact || parsed.data.revenueImpact || old.costImpact || 0);

          // Resolve approver from project_access (canApprove = true) for this project
          const [approverRow] = await db
            .select({ userId: projectAccess.userId })
            .from(projectAccess)
            .where(
              and(
                eq(projectAccess.projectId, old.projectId),
                eq(projectAccess.canApprove, true),
                isNull(projectAccess.deletedAt),
              ),
            )
            .limit(1);

          const approverUserId = approverRow?.userId ?? null;
          if (!approverUserId) {
            console.warn(
              `[ChangeControl] No approver with canApprove=true found for project ${old.projectId}, change request ${old.id}`,
            );
          }

          const approval = await createVoApproval({
            projectId: old.projectId,
            changeRequestId: old.id,
            requestedByUserId: user?.id ?? 0,
            approverUserId,
            title: `Change Request: ${old.title}`,
            revenueImpact: revImpact || undefined,
          });
            updates.approvalId = approval.id;
          } catch (approvalErr: unknown) {
            const msg = approvalErr instanceof Error ? approvalErr.message : String(approvalErr);
            console.warn("[ChangeControl] Approval creation failed:", msg);
          }
        }
      }

      const result = await db.update(changeRequests).set(updates).where(eq(changeRequests.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(id),
        action: "update",
        changesJson: { before: { status: old.status }, after: { status: result[0].status }, updates: parsed.data },
      });

      if (updates.status && updates.status !== old.status) {
        const actor = actorFromReq(req);
        await createProjectEvent({
          projectId: old.projectId,
          eventType: "change.status_changed",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "change_requests",
          sourceEntityId: String(id),
          summary: `Change request status changed: ${old.status} → ${updates.status}`,
          details: { fromStatus: old.status, toStatus: updates.status, title: old.title },
          idempotencyKey: `change-status:${id}:${old.status}:${updates.status}`,
        });
      }
      res.json(result[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ChangeControl] Update error:", message);
      res.status(500).json({ error: "Failed to update change request" });
    }
  });

  app.delete("/api/change-requests/:id", jwtAuth, requireAuth, requirePermission("projects", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      // Soft-delete: mark change request as deleted instead of removing the row
      const user = getEffectiveUser(req);
      const deleteReason = req.body?.deleteReason || null;
      const [deleted] = await db.update(changeRequests).set({
        deletedAt: new Date(),
        deletedBy: user?.id ?? null,
        deleteReason,
      }).where(eq(changeRequests.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(id),
        action: "soft_delete",
        changesJson: { title: existing[0].title, status: existing[0].status, deleteReason },
      });

      res.json({ success: true, deleted });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to delete change request" });
    }
  });

  app.get("/api/change-requests/cross-project/summary", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT cr.status, cr.change_type, COUNT(*)::int as count, pi.project_name
        FROM change_requests cr
        JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.status NOT IN ('closed')
        GROUP BY cr.status, cr.change_type, pi.project_name
        ORDER BY pi.project_name, cr.status
      `));
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch cross-project summary" });
    }
  });
}
