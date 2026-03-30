// ============================================================
// STAGE COLLABORATION ROUTES — Client commitments, updates, queries, access, financial close tracks
// ============================================================

import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import { db } from "./db";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  projectClientCommitments,
  projectClientUpdates,
  projectQueries,
  projectAccess,
  projectStageFinancialCloseTracks,
  projectStageInstances,
} from "@shared/schema";

function getUser(req: Request): { id: number; role: string } {
  const user = (req as any).user;
  return { id: user?.id, role: user?.role || "unknown" };
}

function p(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : (v ?? '');
}

function parseProjectId(req: Request, res: Response): number | null {
  const id = parseInt(p(req.params.projectId), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid projectId" });
    return null;
  }
  return id;
}

function parseId(req: Request, res: Response): number | null {
  const id = parseInt(p(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

export function registerStageCollaborationRoutes(app: Express): void {

  // ════════════════════════════════════════════════════════════
  // CLIENT COMMITMENTS
  // ════════════════════════════════════════════════════════════

  // GET /api/projects/:projectId/client-commitments
  app.get(
    "/api/projects/:projectId/client-commitments",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const statusFilter = req.query.status as string | undefined;

        let query = db
          .select()
          .from(projectClientCommitments)
          .where(eq(projectClientCommitments.projectId, projectId));

        if (statusFilter) {
          query = db
            .select()
            .from(projectClientCommitments)
            .where(and(
              eq(projectClientCommitments.projectId, projectId),
              eq(projectClientCommitments.status, statusFilter),
            ));
        }

        const commitments = await query.orderBy(desc(projectClientCommitments.committedDate));
        res.json({ commitments });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-commitments] list error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/client-commitments
  app.post(
    "/api/projects/:projectId/client-commitments",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const { commitmentText, stageCodeCreated, deliveryStageCode, notes } = req.body;

        if (!commitmentText) {
          return res.status(400).json({ error: "commitmentText is required" });
        }

        const [commitment] = await db.insert(projectClientCommitments).values({
          projectId,
          commitmentText,
          stageCodeCreated: stageCodeCreated || null,
          deliveryStageCode: deliveryStageCode || null,
          committedByUserId: user.id,
          committedDate: new Date(),
          notes: notes || null,
        }).returning();

        res.status(201).json({ commitment });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-commitments] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/client-commitments/:id
  app.patch(
    "/api/projects/:projectId/client-commitments/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;
        const { status, notes, deliveredDate } = req.body;

        const updateData: Record<string, any> = {};
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        if (deliveredDate !== undefined) updateData.deliveredDate = new Date(deliveredDate);
        if (status === "DELIVERED" && !deliveredDate) updateData.deliveredDate = new Date();

        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ error: "No update fields provided" });
        }

        await db.update(projectClientCommitments).set(updateData).where(eq(projectClientCommitments.id, id));
        const [updated] = await db.select().from(projectClientCommitments).where(eq(projectClientCommitments.id, id));
        if (!updated) return res.status(404).json({ error: "Commitment not found" });

        res.json({ commitment: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-commitments] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // CLIENT UPDATES
  // ════════════════════════════════════════════════════════════

  // GET /api/projects/:projectId/client-updates
  app.get(
    "/api/projects/:projectId/client-updates",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;

        const updates = await db
          .select()
          .from(projectClientUpdates)
          .where(eq(projectClientUpdates.projectId, projectId))
          .orderBy(desc(projectClientUpdates.updateNumber));

        res.json({ updates });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-updates] list error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/client-updates
  app.post(
    "/api/projects/:projectId/client-updates",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);

        // Auto-assign next update number
        const [maxRow] = await db
          .select({ maxNum: sql<number>`COALESCE(MAX(update_number), 0)` })
          .from(projectClientUpdates)
          .where(eq(projectClientUpdates.projectId, projectId));

        const nextNumber = (maxRow?.maxNum ?? 0) + 1;

        const {
          dueDate, progressSummaryText, completedThisPeriodText,
          next7DaysText, blockersText, clientActionsRequiredText,
          attachmentUrls, reviewerUserId,
        } = req.body;

        const [update] = await db.insert(projectClientUpdates).values({
          projectId,
          updateNumber: nextNumber,
          dueDate: dueDate || null,
          status: "DRAFT",
          progressSummaryText: progressSummaryText || null,
          completedThisPeriodText: completedThisPeriodText || null,
          next7DaysText: next7DaysText || null,
          blockersText: blockersText || null,
          clientActionsRequiredText: clientActionsRequiredText || null,
          attachmentUrls: attachmentUrls || [],
          reviewerUserId: reviewerUserId || null,
          sentByUserId: user.id,
        }).returning();

        res.status(201).json({ update });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-updates] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/client-updates/:id
  app.patch(
    "/api/projects/:projectId/client-updates/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;

        const allowedFields = [
          'progressSummaryText', 'completedThisPeriodText', 'next7DaysText',
          'blockersText', 'clientActionsRequiredText', 'attachmentUrls',
          'dueDate', 'reviewerUserId',
        ];

        const updateData: Record<string, any> = { updatedAt: new Date() };
        for (const field of allowedFields) {
          if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }

        await db.update(projectClientUpdates).set(updateData).where(eq(projectClientUpdates.id, id));
        const [updated] = await db.select().from(projectClientUpdates).where(eq(projectClientUpdates.id, id));
        if (!updated) return res.status(404).json({ error: "Update not found" });

        res.json({ update: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-updates] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/client-updates/:id/status
  app.patch(
    "/api/projects/:projectId/client-updates/:id/status",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;
        const user = getUser(req);
        const { status } = req.body;

        const validStatuses = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SENT', 'OVERDUE'];
        if (!status || !validStatuses.includes(status)) {
          return res.status(400).json({ error: `Valid status required: ${validStatuses.join(', ')}` });
        }

        const updateData: Record<string, any> = { status, updatedAt: new Date() };
        if (status === 'SENT') {
          updateData.sentDate = new Date();
          updateData.sentByUserId = user.id;
        }

        await db.update(projectClientUpdates).set(updateData).where(eq(projectClientUpdates.id, id));
        const [updated] = await db.select().from(projectClientUpdates).where(eq(projectClientUpdates.id, id));
        if (!updated) return res.status(404).json({ error: "Update not found" });

        res.json({ update: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[client-updates] status error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // PROJECT QUERIES
  // ════════════════════════════════════════════════════════════

  // GET /api/projects/:projectId/queries
  app.get(
    "/api/projects/:projectId/queries",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const statusFilter = req.query.status as string | undefined;
        const assignedToUserId = req.query.assignedToUserId as string | undefined;

        const conditions = [eq(projectQueries.projectId, projectId)];
        if (statusFilter) conditions.push(eq(projectQueries.status, statusFilter));
        if (assignedToUserId) conditions.push(eq(projectQueries.assignedToUserId, parseInt(assignedToUserId, 10)));

        const queries = await db
          .select()
          .from(projectQueries)
          .where(and(...conditions))
          .orderBy(desc(projectQueries.createdAt));

        res.json({ queries });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[queries] list error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/queries
  app.post(
    "/api/projects/:projectId/queries",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const {
          stageCode, queryType, raisedByDepartment,
          assignedToUserId, assignedToDepartment,
          subject, description, priority,
        } = req.body;

        if (!queryType || !subject || !description) {
          return res.status(400).json({ error: "queryType, subject, and description are required" });
        }

        const [query] = await db.insert(projectQueries).values({
          projectId,
          stageCode: stageCode || null,
          queryType,
          raisedByUserId: user.id,
          raisedByDepartment: raisedByDepartment || null,
          assignedToUserId: assignedToUserId || null,
          assignedToDepartment: assignedToDepartment || null,
          subject,
          description,
          priority: priority || "NORMAL",
        }).returning();

        res.status(201).json({ query });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[queries] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/queries/:id
  app.patch(
    "/api/projects/:projectId/queries/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;
        const user = getUser(req);
        const {
          status, assignedToUserId, assignedToDepartment,
          responseText, priority,
        } = req.body;

        const updateData: Record<string, any> = {};
        if (status !== undefined) updateData.status = status;
        if (assignedToUserId !== undefined) updateData.assignedToUserId = assignedToUserId;
        if (assignedToDepartment !== undefined) updateData.assignedToDepartment = assignedToDepartment;
        if (priority !== undefined) updateData.priority = priority;

        if (responseText !== undefined) {
          updateData.responseText = responseText;
          updateData.respondedByUserId = user.id;
          updateData.respondedDate = new Date();
          if (!status) updateData.status = "ANSWERED";
        }

        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ error: "No update fields provided" });
        }

        await db.update(projectQueries).set(updateData).where(eq(projectQueries.id, id));
        const [updated] = await db.select().from(projectQueries).where(eq(projectQueries.id, id));
        if (!updated) return res.status(404).json({ error: "Query not found" });

        res.json({ query: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[queries] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // PROJECT ACCESS
  // ════════════════════════════════════════════════════════════

  // GET /api/projects/:projectId/access
  app.get(
    "/api/projects/:projectId/access",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;

        const grants = await db
          .select()
          .from(projectAccess)
          .where(eq(projectAccess.projectId, projectId))
          .orderBy(projectAccess.grantedAt);

        res.json({ grants });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[project-access] list error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/access — upsert by projectId+userId
  app.post(
    "/api/projects/:projectId/access",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const grantor = getUser(req);
        const {
          userId, accessLevel, roleOnProject, stagesVisible,
          canEdit, canApprove, expiresAt, notes,
        } = req.body;

        if (!userId || !accessLevel) {
          return res.status(400).json({ error: "userId and accessLevel are required" });
        }

        // Check if grant already exists for this user+project
        const [existing] = await db
          .select()
          .from(projectAccess)
          .where(and(
            eq(projectAccess.projectId, projectId),
            eq(projectAccess.userId, userId),
          ));

        if (existing) {
          // Update existing
          await db.update(projectAccess).set({
            accessLevel,
            roleOnProject: roleOnProject ?? existing.roleOnProject,
            stagesVisible: stagesVisible ?? existing.stagesVisible,
            canEdit: canEdit ?? existing.canEdit,
            canApprove: canApprove ?? existing.canApprove,
            expiresAt: expiresAt ? new Date(expiresAt) : existing.expiresAt,
            notes: notes ?? existing.notes,
            grantedByUserId: grantor.id,
            grantedAt: new Date(),
          }).where(eq(projectAccess.id, existing.id));

          const [updated] = await db.select().from(projectAccess).where(eq(projectAccess.id, existing.id));
          return res.json({ grant: updated });
        }

        const [grant] = await db.insert(projectAccess).values({
          projectId,
          userId,
          accessLevel,
          roleOnProject: roleOnProject || null,
          stagesVisible: stagesVisible || ["all"],
          canEdit: canEdit ?? false,
          canApprove: canApprove ?? false,
          grantedByUserId: grantor.id,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          notes: notes || null,
        }).returning();

        res.status(201).json({ grant });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[project-access] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/access/:id
  app.patch(
    "/api/projects/:projectId/access/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;
        const grantor = getUser(req);

        const allowedFields = ['accessLevel', 'roleOnProject', 'stagesVisible', 'canEdit', 'canApprove', 'expiresAt', 'notes'];
        const updateData: Record<string, any> = { grantedByUserId: grantor.id, grantedAt: new Date() };

        for (const field of allowedFields) {
          if (req.body[field] !== undefined) {
            if (field === 'expiresAt' && req.body[field]) {
              updateData[field] = new Date(req.body[field]);
            } else {
              updateData[field] = req.body[field];
            }
          }
        }

        await db.update(projectAccess).set(updateData).where(eq(projectAccess.id, id));
        const [updated] = await db.select().from(projectAccess).where(eq(projectAccess.id, id));
        if (!updated) return res.status(404).json({ error: "Access grant not found" });

        res.json({ grant: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[project-access] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // DELETE /api/projects/:projectId/access/:id
  app.delete(
    "/api/projects/:projectId/access/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;

        const [existing] = await db.select().from(projectAccess).where(eq(projectAccess.id, id));
        if (!existing) return res.status(404).json({ error: "Access grant not found" });

        await db.update(projectAccess).set({ deletedAt: new Date(), deletedBy: getUser(req).id }).where(eq(projectAccess.id, id)).returning();
        res.json({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[project-access] delete error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // FINANCIAL CLOSE TRACKS
  // ════════════════════════════════════════════════════════════

  // GET /api/projects/:projectId/financial-close-tracks
  app.get(
    "/api/projects/:projectId/financial-close-tracks",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;

        const tracks = await db
          .select()
          .from(projectStageFinancialCloseTracks)
          .where(eq(projectStageFinancialCloseTracks.projectId, projectId))
          .orderBy(projectStageFinancialCloseTracks.trackCode);

        res.json({ tracks });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-close-tracks] list error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/financial-close-tracks
  app.post(
    "/api/projects/:projectId/financial-close-tracks",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const { stageInstanceId, trackCode, trackLabel, isRequired, notes } = req.body;

        if (!trackCode || !trackLabel) {
          return res.status(400).json({ error: "trackCode and trackLabel are required" });
        }

        const [track] = await db.insert(projectStageFinancialCloseTracks).values({
          projectId,
          stageInstanceId: stageInstanceId || null,
          trackCode,
          trackLabel,
          isRequired: isRequired ?? true,
          notes: notes || null,
        }).returning();

        res.status(201).json({ track });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-close-tracks] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/financial-close-tracks/:id
  app.patch(
    "/api/projects/:projectId/financial-close-tracks/:id",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req, res);
        if (!id) return;
        const { signed, signedDate, documentUrl, isRequired, notes } = req.body;

        const updateData: Record<string, any> = { updatedAt: new Date() };
        if (signed !== undefined) updateData.signed = signed;
        if (signedDate !== undefined) updateData.signedDate = signedDate;
        if (documentUrl !== undefined) updateData.documentUrl = documentUrl;
        if (isRequired !== undefined) updateData.isRequired = isRequired;
        if (notes !== undefined) updateData.notes = notes;
        if (signed === true && !signedDate) updateData.signedDate = new Date().toISOString().split('T')[0];

        await db.update(projectStageFinancialCloseTracks).set(updateData).where(eq(projectStageFinancialCloseTracks.id, id));
        const [updated] = await db.select().from(projectStageFinancialCloseTracks).where(eq(projectStageFinancialCloseTracks.id, id));
        if (!updated) return res.status(404).json({ error: "Track not found" });

        res.json({ track: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-close-tracks] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/financial-close-tracks/initialize — create default 4 tracks
  app.post(
    "/api/projects/:projectId/financial-close-tracks/initialize",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;

        // Find the S03 stage instance for this project
        const stages = await db
          .select()
          .from(projectStageInstances)
          .where(eq(projectStageInstances.projectId, projectId));

        const s03 = stages.find((s: any) => s.stageCode === "S03_SIGNATURE_FINANCIAL_CLOSE");
        const stageInstanceId = s03?.id ?? null;

        // Check existing tracks
        const existing = await db
          .select()
          .from(projectStageFinancialCloseTracks)
          .where(eq(projectStageFinancialCloseTracks.projectId, projectId));

        const existingCodes = new Set(existing.map((t: any) => t.trackCode));

        const defaultTracks = [
          { trackCode: "COST_PROPOSAL", trackLabel: "Cost Proposal" },
          { trackCode: "EPC", trackLabel: "EPC Contract" },
          { trackCode: "FUNDING_CONTRACT", trackLabel: "Funding Contract" },
          { trackCode: "OM", trackLabel: "O&M Contract" },
        ];

        const toCreate = defaultTracks
          .filter(t => !existingCodes.has(t.trackCode))
          .map(t => ({
            projectId,
            stageInstanceId,
            trackCode: t.trackCode,
            trackLabel: t.trackLabel,
            isRequired: true,
            signed: false,
          }));

        if (toCreate.length > 0) {
          await db.insert(projectStageFinancialCloseTracks).values(toCreate);
        }

        const tracks = await db
          .select()
          .from(projectStageFinancialCloseTracks)
          .where(eq(projectStageFinancialCloseTracks.projectId, projectId))
          .orderBy(projectStageFinancialCloseTracks.trackCode);

        res.status(201).json({ tracks, created: toCreate.length });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-close-tracks] initialize error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );
}
