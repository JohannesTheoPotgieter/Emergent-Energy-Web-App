import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, sql, ilike } from "drizzle-orm";
import { commissioningItems, projectEngStages, engStageTemplates, approvals } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser, type AuthenticatedUser } from "./auth-context";
import { evaluateEvidence, isEvidenceOverrideAuthorized, upsertEvidenceItem } from "./services/evidence-evaluation-service";

/** Check whether the Handover Pack engineering stage is complete for a project. */
async function isHandoverPackComplete(projectId: number): Promise<{ complete: boolean; stageName?: string; status?: string }> {
  const stages = await db
    .select({ id: projectEngStages.id, status: projectEngStages.status, name: engStageTemplates.name })
    .from(projectEngStages)
    .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
    .where(and(eq(projectEngStages.projectId, projectId), ilike(engStageTemplates.name, '%Handover Pack%')));
  if (stages.length === 0) return { complete: false, stageName: "Handover Pack", status: "not_found" };
  const stage = stages[0];
  return { complete: stage.status === "complete", stageName: stage.name, status: stage.status };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ['in_progress'],
  in_progress: ['ready_for_review', 'not_started'],
  ready_for_review: ['approved', 'in_progress'],
  approved: ['closed'],
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

export function registerCommissioningRoutes(app: Express): void {
  app.get("/api/commissioning/project/:projectId", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const typeFilter = req.query.itemType as string | undefined;
      const VALID_ITEM_TYPES = new Set(["commissioning", "closeout", "handover", "punchlist", "inspection", "test"]);
      const safeTypeFilter = typeFilter && VALID_ITEM_TYPES.has(typeFilter) ? typeFilter : null;
      let whereClause = `WHERE ci.project_id = ${projectId}`;
      if (safeTypeFilter) whereClause += ` AND ci.item_type = '${safeTypeFilter}'`;

      const rows = await db.execute(sql.raw(`
        SELECT ci.*, u.name as owner_name, p.project_name
        FROM commissioning_items ci
        LEFT JOIN users u ON ci.owner_user_id = u.id
        LEFT JOIN project_info p ON ci.project_id = p.id
        ${whereClause}
        ORDER BY ci.category, ci.sort_order, ci.created_at
      `));
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Commissioning] List error:", message);
      res.status(500).json({ error: "Failed to fetch commissioning items" });
    }
  });

  app.get("/api/commissioning/:id", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT ci.*, u.name as owner_name, p.project_name
        FROM commissioning_items ci
        LEFT JOIN users u ON ci.owner_user_id = u.id
        LEFT JOIN project_info p ON ci.project_id = p.id
        WHERE ci.id = ${id}
      `));
      const items = rowsFromResult(rows);
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch commissioning item" });
    }
  });

  app.post("/api/commissioning", jwtAuth, requireAuth, requirePermission("commissioning", "create"), async (req: Request, res: Response) => {
    try {
      const { projectId, itemType, title, description, ownerUserId, dueDate, gateId, category, sortOrder } = req.body;
      if (!projectId || !title) return res.status(400).json({ error: "projectId and title required" });

      const result = await db.insert(commissioningItems).values({
        projectId,
        itemType: itemType || 'commissioning',
        title,
        description: description || null,
        ownerUserId: ownerUserId || null,
        dueDate: dueDate || null,
        status: 'not_started',
        gateId: gateId || null,
        category: category || null,
        sortOrder: sortOrder || 0,
      }).returning();

      logAuditFromReq(req, {
        entityType: "commissioning_item",
        entityId: String(result[0].id),
        action: "create",
        changesJson: { title, itemType: itemType || 'commissioning', projectId },
      });

      res.status(201).json(result[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Commissioning] Create error:", message);
      res.status(500).json({ error: "Failed to create commissioning item" });
    }
  });

  app.patch("/api/commissioning/:id", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const fields = ['title', 'description', 'ownerUserId', 'dueDate', 'evidenceNotes', 'gateId', 'category', 'sortOrder', 'itemType'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      if (req.body.status !== undefined && req.body.status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${req.body.status}` });
        }

        // Gate: commissioning cannot progress until Handover Pack stage is complete
        if (old.status === "not_started" && req.body.status === "in_progress") {
          const hp = await isHandoverPackComplete(old.projectId);
          if (!hp.complete) {
            return res.status(400).json({
              error: "Commissioning cannot start until the Engineering Handover Pack stage is complete.",
              handoverPack: hp,
            });
          }
        }

        updates.status = req.body.status;

        if (req.body.status === 'approved' || req.body.status === 'closed') {
          const user = getEffectiveUser(req);
          const overrideReason = String(req.body?.evidenceOverrideReason || "").trim();
          const wantsOverride = !!overrideReason;

          const evidence = await evaluateEvidence({
            projectId: old.projectId,
            completionType: "commissioning_item_close",
            sourceType: "commissioning_item",
            sourceRef: String(id),
            additionalEvidence: old.evidenceNotes ? [{ evidenceType: "form", requirementKey: "evidence_notes" }] : [],
            evaluatorUserId: user?.id,
            evaluatorName: user?.name,
          });

          if (!evidence.pass) {
            if (!wantsOverride) {
              return res.status(400).json({
                error: "Completion blocked: evidence score below threshold.",
                evidence,
              });
            }
            if (!isEvidenceOverrideAuthorized(user?.role)) {
              return res.status(403).json({ error: "Evidence override requires authorized role." });
            }

            await db.execute(sql.raw(`
              INSERT INTO evidence_override_records
                (project_id, completion_type, source_type, source_ref, score_percent, threshold_percent, reason, authorized_by_user_id, authorized_by_name, authorized_by_role)
              VALUES
                (${old.projectId}, 'commissioning_item_close', 'commissioning_item', '${id}', ${evidence.score}, ${evidence.threshold}, '${overrideReason.replace(/'/g, "''")}', ${user?.id || "NULL"}, ${user?.name ? `'${String(user.name).replace(/'/g, "''")}'` : "NULL"}, ${user?.role ? `'${String(user.role).replace(/'/g, "''")}'` : "NULL"})
            `));

            logAuditFromReq(req, {
              entityType: "project_timeline",
              entityId: String(old.projectId),
              action: "evidence.override",
              projectName: undefined,
              changesJson: { sourceType: "commissioning_item", sourceRef: String(id), overrideReason, evidence },
            });
          }

          updates.completedAt = new Date();
        }

        if (req.body.status === 'ready_for_review' && !old.approvalId) {
          try {
            const user = getEffectiveUser(req);
            const approvalResult = await db.insert(approvals).values({
              type: old.itemType || 'commissioning',
              title: `${old.itemType === 'closeout' ? 'Closeout' : 'Commissioning'}: ${old.title}`,
              description: old.description || '',
              status: 'pending',
              requestedBy: user?.id,
              projectId: old.projectId,
            }).returning();
            updates.approvalId = approvalResult[0].id;
          } catch (approvalErr: unknown) {
            const msg = approvalErr instanceof Error ? approvalErr.message : String(approvalErr);
            console.warn("[Commissioning] Approval creation failed:", msg);
          }
        }
      }

      const result = await db.update(commissioningItems).set(updates).where(eq(commissioningItems.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "commissioning_item",
        entityId: String(id),
        action: "update",
        changesJson: { before: { status: old.status }, after: { status: result[0].status }, updates: req.body },
      });

      res.json(result[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Commissioning] Update error:", message);
      res.status(500).json({ error: "Failed to update commissioning item" });
    }
  });

  app.delete("/api/commissioning/:id", jwtAuth, requireAuth, requirePermission("commissioning", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      await db.delete(commissioningItems).where(eq(commissioningItems.id, id));

      logAuditFromReq(req, {
        entityType: "commissioning_item",
        entityId: String(id),
        action: "delete",
        changesJson: { title: existing[0].title, status: existing[0].status },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to delete commissioning item" });
    }
  });

  app.get("/api/commissioning/progress/:projectId", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const rows = await db.execute(sql.raw(`
        SELECT
          category,
          item_type,
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'closed' OR status = 'approved')::int as completed,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
          COUNT(*) FILTER (WHERE status = 'ready_for_review')::int as review
        FROM commissioning_items
        WHERE project_id = ${projectId}
        GROUP BY category, item_type
        ORDER BY category
      `));
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch progress" });
    }
  });

  /** Check if commissioning is unlocked for a project (Handover Pack gate) */
  app.get("/api/commissioning/gate-status/:projectId", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      const hp = await isHandoverPackComplete(projectId);
      res.json({ unlocked: hp.complete, handoverPack: hp });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to check gate status" });
    }
  });

  app.post("/api/commissioning/:id/evidence", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [item] = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (!item) return res.status(404).json({ error: "Not found" });
      const user = getEffectiveUser(req);

      const payload = req.body || {};
      await upsertEvidenceItem({
        projectId: item.projectId,
        completionType: "commissioning_item_close",
        sourceType: "commissioning_item",
        sourceRef: String(id),
        requirementKey: payload.requirementKey || null,
        evidenceType: payload.evidenceType || "document",
        title: payload.title || null,
        valueRef: payload.valueRef || null,
        valueJson: payload.valueJson,
        uploadedByUserId: user?.id,
        uploadedByName: user?.name,
      });

      const evidence = await evaluateEvidence({
        projectId: item.projectId,
        completionType: "commissioning_item_close",
        sourceType: "commissioning_item",
        sourceRef: String(id),
        additionalEvidence: item.evidenceNotes ? [{ evidenceType: "form", requirementKey: "evidence_notes" }] : [],
        evaluatorUserId: user?.id,
        evaluatorName: user?.name,
      });

      logAuditFromReq(req, {
        entityType: "project_timeline",
        entityId: String(item.projectId),
        action: "evidence.collected",
        changesJson: { sourceType: "commissioning_item", sourceRef: String(id), payload },
      });

      res.status(201).json({ success: true, evidence });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Commissioning] evidence add error:", message);
      res.status(500).json({ error: "Failed to add evidence" });
    }
  });

  app.get("/api/commissioning/:id/evidence-evaluation", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [item] = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (!item) return res.status(404).json({ error: "Not found" });
      const user = getEffectiveUser(req);
      const evidence = await evaluateEvidence({
        projectId: item.projectId,
        completionType: "commissioning_item_close",
        sourceType: "commissioning_item",
        sourceRef: String(id),
        additionalEvidence: item.evidenceNotes ? [{ evidenceType: "form", requirementKey: "evidence_notes" }] : [],
        evaluatorUserId: user?.id,
        evaluatorName: user?.name,
      });
      res.json(evidence);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to evaluate evidence" });
    }
  });
}
