// ============================================================
// PROJECT DELIVERY MILESTONES — Wave-4 audit (2026-05-26)
//
// Site-delivery milestones (Mobilisation, 25% Civils, Structures
// Complete, DC Wiring, AC Connection, First Energization, COD, …).
// Distinct from the billing-side "Revenue Milestones" tracker.
//
// Endpoints:
//   GET    /api/projects/:projectId/delivery-milestones
//   POST   /api/projects/:projectId/delivery-milestones
//   PATCH  /api/projects/delivery-milestones/:id
//   DELETE /api/projects/delivery-milestones/:id
//
// Per Six Rule #1 every milestone FKs to project_info.id. Per § 4A the
// blocker field is soft — recorded, not blocked. Per § 4 every state
// change emits an audit event.
// ============================================================

import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { projectDeliveryMilestones, projectInfo } from "@shared/schema";
import { jwtAuth, requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { actorFromReq, createProjectEvent } from "../services/project-event-service";
import { parseIntParam } from "../lib/req-params";
import { z } from "zod";

const createSchema = z.object({
  milestoneCode: z.string().min(1).max(64),
  milestoneName: z.string().min(1).max(200),
  phaseCode: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  plannedDate: z.string().nullable().optional(),
  ownerUserId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateSchema = z.object({
  milestoneName: z.string().min(1).max(200).optional(),
  phaseCode: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  plannedDate: z.string().nullable().optional(),
  actualDate: z.string().nullable().optional(),
  status: z.enum(["planned", "in_progress", "complete", "overdue", "blocked"]).optional(),
  ownerUserId: z.number().int().nullable().optional(),
  blocker: z.string().nullable().optional(),
  evidenceLink: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function deriveStatus(input: {
  plannedDate: string | null | undefined;
  actualDate: string | null | undefined;
  blocker: string | null | undefined;
  explicit?: string | null | undefined;
}): "planned" | "in_progress" | "complete" | "overdue" | "blocked" {
  if (input.explicit) return input.explicit as any;
  if (input.actualDate) return "complete";
  if (input.blocker && input.blocker.trim()) return "blocked";
  if (input.plannedDate) {
    const planned = new Date(input.plannedDate + "T00:00:00Z").getTime();
    if (!Number.isNaN(planned) && planned < Date.now()) return "overdue";
  }
  return "planned";
}

export function registerDeliveryMilestonesRoutes(app: Express) {
  // LIST -----------------------------------------------------------------
  app.get(
    "/api/projects/:projectId/delivery-milestones",
    jwtAuth,
    requireAuth,
    requirePermission("pd_delivery_milestones", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

        const rows = await db
          .select()
          .from(projectDeliveryMilestones)
          .where(
            and(
              eq(projectDeliveryMilestones.projectId, projectId),
              isNull(projectDeliveryMilestones.deletedAt),
            ),
          )
          .orderBy(
            asc(projectDeliveryMilestones.sortOrder),
            asc(projectDeliveryMilestones.id),
          );

        res.json({ milestones: rows });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[delivery-milestones] list error:", msg);
        res.status(500).json({ error: "Failed to load delivery milestones" });
      }
    },
  );

  // CREATE ---------------------------------------------------------------
  app.post(
    "/api/projects/:projectId/delivery-milestones",
    jwtAuth,
    requireAuth,
    requirePermission("pd_delivery_milestones", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten().fieldErrors });
        }
        const data = parsed.data;
        const user = getEffectiveUser(req);

        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
        if (!project) return res.status(404).json({ error: "Project not found" });

        const status = deriveStatus({
          plannedDate: data.plannedDate ?? null,
          actualDate: null,
          blocker: null,
        });

        const [created] = await db
          .insert(projectDeliveryMilestones)
          .values({
            projectId,
            milestoneCode: data.milestoneCode,
            milestoneName: data.milestoneName,
            phaseCode: data.phaseCode ?? null,
            sortOrder: data.sortOrder ?? 0,
            plannedDate: data.plannedDate ?? null,
            actualDate: null,
            status,
            ownerUserId: data.ownerUserId ?? null,
            notes: data.notes ?? null,
            createdByUserId: user?.id ?? null,
          })
          .returning();

        logAuditFromReq(req, {
          entityType: "delivery_milestone",
          entityId: String(created.id),
          action: "create",
          changesJson: {
            projectId,
            milestoneCode: created.milestoneCode,
            plannedDate: created.plannedDate,
          },
        });

        const actor = actorFromReq(req);
        await createProjectEvent({
          projectId,
          eventType: "delivery_milestone.created",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "project_delivery_milestone",
          sourceEntityId: String(created.id),
          summary: `Delivery milestone created: ${created.milestoneName}`,
          details: { milestoneCode: created.milestoneCode, plannedDate: created.plannedDate },
          idempotencyKey: `delivery-milestone-created:${created.id}`,
        });

        res.status(201).json({ milestone: created });
      } catch (err: any) {
        // Hit the partial unique index on (project_id, milestone_code).
        if (String(err?.code) === "23505") {
          return res.status(409).json({
            error: "duplicate_milestone_code",
            message:
              "A delivery milestone with this code already exists on this project. Use a different code or PATCH the existing row.",
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[delivery-milestones] create error:", msg);
        res.status(500).json({ error: "Failed to create delivery milestone" });
      }
    },
  );

  // UPDATE ---------------------------------------------------------------
  app.patch(
    "/api/projects/delivery-milestones/:id",
    jwtAuth,
    requireAuth,
    requirePermission("pd_delivery_milestones", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten().fieldErrors });
        }
        const data = parsed.data;
        const user = getEffectiveUser(req);

        const [existing] = await db
          .select()
          .from(projectDeliveryMilestones)
          .where(eq(projectDeliveryMilestones.id, id));
        if (!existing) return res.status(404).json({ error: "Milestone not found" });
        if (existing.deletedAt) return res.status(410).json({ error: "Milestone deleted" });

        // Soft-required evidence on completion — surface a warning but
        // do not block (§ 0A override principle: app records, doesn't
        // refuse). The caller can resubmit with evidenceLink.
        const nowCompleting =
          data.actualDate !== undefined && data.actualDate !== null && !existing.actualDate;
        const willHaveEvidence =
          (data.evidenceLink !== undefined ? data.evidenceLink : existing.evidenceLink) ?? null;
        const missingEvidenceWarning =
          nowCompleting && !willHaveEvidence
            ? "Marking milestone complete without an evidence link. Per § 4A this is allowed but the gap is recorded."
            : null;

        // Blocker bookkeeping.
        const now = new Date();
        let blockerSetAt = existing.blockerSetAt;
        let blockerClearedAt = existing.blockerClearedAt;
        if (data.blocker !== undefined) {
          const newBlocker = data.blocker ?? null;
          const oldBlocker = existing.blocker ?? null;
          if (newBlocker && !oldBlocker) blockerSetAt = now;
          if (!newBlocker && oldBlocker) blockerClearedAt = now;
        }

        const status = deriveStatus({
          plannedDate: data.plannedDate ?? existing.plannedDate ?? null,
          actualDate: data.actualDate ?? existing.actualDate ?? null,
          blocker: data.blocker !== undefined ? data.blocker : existing.blocker,
          explicit: data.status,
        });

        const updates: Record<string, any> = { updatedAt: now, status };
        if (data.milestoneName !== undefined) updates.milestoneName = data.milestoneName;
        if (data.phaseCode !== undefined) updates.phaseCode = data.phaseCode;
        if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;
        if (data.plannedDate !== undefined) updates.plannedDate = data.plannedDate;
        if (data.actualDate !== undefined) updates.actualDate = data.actualDate;
        if (data.ownerUserId !== undefined) updates.ownerUserId = data.ownerUserId;
        if (data.blocker !== undefined) updates.blocker = data.blocker;
        if (data.evidenceLink !== undefined) updates.evidenceLink = data.evidenceLink;
        if (data.notes !== undefined) updates.notes = data.notes;
        updates.blockerSetAt = blockerSetAt;
        updates.blockerClearedAt = blockerClearedAt;
        if (nowCompleting) updates.completedByUserId = user?.id ?? null;

        const [updated] = await db
          .update(projectDeliveryMilestones)
          .set(updates)
          .where(eq(projectDeliveryMilestones.id, id))
          .returning();

        logAuditFromReq(req, {
          entityType: "delivery_milestone",
          entityId: String(id),
          action: "update",
          changesJson: {
            projectId: existing.projectId,
            fromStatus: existing.status,
            toStatus: updated.status,
            updatedKeys: Object.keys(data),
            missingEvidenceWarning,
          },
        });

        const actor = actorFromReq(req);
        if (nowCompleting) {
          await createProjectEvent({
            projectId: existing.projectId,
            eventType: "delivery_milestone.completed",
            actorUserId: actor.actorUserId,
            actorRole: actor.actorRole,
            sourceEntityType: "project_delivery_milestone",
            sourceEntityId: String(id),
            summary: `Delivery milestone complete: ${updated.milestoneName}`,
            details: {
              milestoneCode: updated.milestoneCode,
              actualDate: updated.actualDate,
              hasEvidence: !!willHaveEvidence,
            },
            idempotencyKey: `delivery-milestone-completed:${id}`,
          });
        }

        res.json({
          milestone: updated,
          warning: missingEvidenceWarning ?? undefined,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[delivery-milestones] update error:", msg);
        res.status(500).json({ error: "Failed to update delivery milestone" });
      }
    },
  );

  // SOFT-DELETE ---------------------------------------------------------
  app.delete(
    "/api/projects/delivery-milestones/:id",
    jwtAuth,
    requireAuth,
    requirePermission("pd_delivery_milestones", "delete"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

        const [existing] = await db
          .select()
          .from(projectDeliveryMilestones)
          .where(eq(projectDeliveryMilestones.id, id));
        if (!existing || existing.deletedAt) return res.status(404).json({ error: "Milestone not found" });

        // Refuse to delete a completed milestone unless overrideReason
        // is supplied — completion is a load-bearing audit event.
        const overrideReason =
          typeof req.body?.overrideReason === "string" && req.body.overrideReason.trim().length > 0
            ? req.body.overrideReason.trim()
            : null;
        if (existing.status === "complete" && !overrideReason) {
          return res.status(409).json({
            error: "milestone_complete",
            message:
              "This milestone is already complete. Pass overrideReason to record the deletion.",
          });
        }

        await db
          .update(projectDeliveryMilestones)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(projectDeliveryMilestones.id, id));

        logAuditFromReq(req, {
          entityType: "delivery_milestone",
          entityId: String(id),
          action: "soft_delete",
          changesJson: {
            projectId: existing.projectId,
            milestoneCode: existing.milestoneCode,
            wasStatus: existing.status,
            overrideReason,
          },
        });

        res.json({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[delivery-milestones] delete error:", msg);
        res.status(500).json({ error: "Failed to delete delivery milestone" });
      }
    },
  );
}
