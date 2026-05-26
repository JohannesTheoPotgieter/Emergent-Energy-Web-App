// ============================================================
// STAGE DATA ROUTES — Stage-specific fields + Project Charter CRUD
// ============================================================

import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { db } from "./db";
import { and, eq } from "drizzle-orm";
import { projectStageData, projectCharters } from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";
import { parseIntParam } from "./lib/req-params";

function getUser(req: Request): { id: number; role: string } {
  const user = (req as any).user;
  return { id: user?.id, role: user?.role || "unknown" };
}

function parseProjectId(req: Request, res: Response): number | null {
  const id = parseIntParam(req.params.projectId);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid projectId" });
    return null;
  }
  return id;
}

export function registerStageDataRoutes(app: Express): void {

  // ── Stage Data (JSONB) ─────────────────────────────────────

  // GET /api/projects/:projectId/stage-data/:stageCode
  app.get(
    "/api/projects/:projectId/stage-data/:stageCode",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = String(req.params.stageCode);

        const [row] = await db
          .select()
          .from(projectStageData)
          .where(and(
            eq(projectStageData.projectId, projectId),
            eq(projectStageData.stageCode, stageCode),
          ));

        res.json({ stageData: row || null, data: row?.data || {} });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-data] get error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PUT /api/projects/:projectId/stage-data/:stageCode — Upsert
  app.put(
    "/api/projects/:projectId/stage-data/:stageCode",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const stageCode = String(req.params.stageCode);
        const { data } = req.body;

        if (!data || typeof data !== "object") {
          return res.status(400).json({ error: "data object required" });
        }

        // Check if row exists
        const [existing] = await db
          .select()
          .from(projectStageData)
          .where(and(
            eq(projectStageData.projectId, projectId),
            eq(projectStageData.stageCode, stageCode),
          ));

        if (existing) {
          // Merge new data with existing
          const merged = { ...(existing.data as object || {}), ...data };
          await db
            .update(projectStageData)
            .set({
              data: merged,
              updatedByUserId: user.id,
              updatedAt: new Date(),
            })
            .where(eq(projectStageData.id, existing.id));

          const [updated] = await db
            .select()
            .from(projectStageData)
            .where(eq(projectStageData.id, existing.id));
          // Wave-3 audit (§ 3A.1) — stage-data mutations now emit audit
          // events. The merged-keys list lets reviewers see WHICH stage
          // fields changed without leaking the full payload.
          logAuditFromReq(req, {
            entityType: "stage_data",
            entityId: String(existing.id),
            action: "update",
            changesJson: { projectId, stageCode, mergedKeys: Object.keys(data ?? {}) },
          });
          res.json({ stageData: updated, data: updated.data });
        } else {
          const [created] = await db
            .insert(projectStageData)
            .values({
              projectId,
              stageCode,
              data,
              updatedByUserId: user.id,
            })
            .returning();
          logAuditFromReq(req, {
            entityType: "stage_data",
            entityId: String(created.id),
            action: "create",
            changesJson: { projectId, stageCode, keys: Object.keys(data ?? {}) },
          });
          res.status(201).json({ stageData: created, data: created.data });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-data] upsert error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Project Charter ────────────────────────────────────────

  // GET /api/projects/:projectId/charter
  app.get(
    "/api/projects/:projectId/charter",
    jwtAuth,
    requireAuth,
    requirePermission("project_charter", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;

        const [charter] = await db
          .select()
          .from(projectCharters)
          .where(eq(projectCharters.projectId, projectId));

        res.json({ charter: charter || null });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[charter] get error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PUT /api/projects/:projectId/charter — Upsert
  app.put(
    "/api/projects/:projectId/charter",
    jwtAuth,
    requireAuth,
    requirePermission("project_charter", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const charterData = req.body;

        // Remove fields that shouldn't be set directly
        delete charterData.id;
        delete charterData.projectId;
        delete charterData.createdAt;
        delete charterData.updatedAt;

        const [existing] = await db
          .select()
          .from(projectCharters)
          .where(eq(projectCharters.projectId, projectId));

        if (existing) {
          await db
            .update(projectCharters)
            .set({
              ...charterData,
              updatedByUserId: user.id,
              updatedAt: new Date(),
            })
            .where(eq(projectCharters.id, existing.id));

          const [updated] = await db
            .select()
            .from(projectCharters)
            .where(eq(projectCharters.id, existing.id));
          logAuditFromReq(req, {
            entityType: "project_charter",
            entityId: String(existing.id),
            action: "update",
            changesJson: { projectId, updatedKeys: Object.keys(charterData ?? {}) },
          });
          res.json({ charter: updated });
        } else {
          const [created] = await db
            .insert(projectCharters)
            .values({
              ...charterData,
              projectId,
              createdByUserId: user.id,
              updatedByUserId: user.id,
            })
            .returning();
          logAuditFromReq(req, {
            entityType: "project_charter",
            entityId: String(created.id),
            action: "create",
            changesJson: { projectId, keys: Object.keys(charterData ?? {}) },
          });
          res.status(201).json({ charter: created });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[charter] upsert error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/charter/status
  app.patch(
    "/api/projects/:projectId/charter/status",
    jwtAuth,
    requireAuth,
    requirePermission("project_charter", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const { status } = req.body;

        if (!status || !["draft", "complete", "reviewed", "accepted"].includes(status)) {
          return res.status(400).json({ error: "Valid status required: draft, complete, reviewed, accepted" });
        }

        const [existing] = await db
          .select()
          .from(projectCharters)
          .where(eq(projectCharters.projectId, projectId));

        if (!existing) {
          return res.status(404).json({ error: "Charter not found" });
        }

        await db
          .update(projectCharters)
          .set({ status, updatedByUserId: user.id, updatedAt: new Date() })
          .where(eq(projectCharters.id, existing.id));

        const [updated] = await db
          .select()
          .from(projectCharters)
          .where(eq(projectCharters.id, existing.id));

        // Wave-3 audit — § 3A.1: charter status moves draft→complete→
        // reviewed→accepted, a stage-gate transition that must be auditable.
        logAuditFromReq(req, {
          entityType: "project_charter",
          entityId: String(existing.id),
          action: "status_change",
          changesJson: { projectId, fromStatus: existing.status, toStatus: status },
        });

        res.json({ charter: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[charter] status update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );
}
