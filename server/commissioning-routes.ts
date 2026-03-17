// @ts-nocheck
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { commissioningItems, projectInfo, users, approvals } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { evaluateEvidence, isEvidenceOverrideAuthorized, upsertEvidenceItem } from "./services/evidence-evaluation-service";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ['in_progress'],
  in_progress: ['ready_for_review', 'not_started'],
  ready_for_review: ['approved', 'in_progress'],
  approved: ['closed'],
  closed: [],
};


export function registerCommissioningRoutes(app: Express) {
  app.get("/api/commissioning/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const typeFilter = req.query.itemType as string | undefined;
      let whereClause = `WHERE ci.project_id = ${projectId}`;
      if (typeFilter) whereClause += ` AND ci.item_type = '${typeFilter}'`;

      const rows = await db.execute(sql.raw(`
        SELECT ci.*, u.name as owner_name, p.project_name
        FROM commissioning_items ci
        LEFT JOIN users u ON ci.owner_user_id = u.id
        LEFT JOIN project_info p ON ci.project_id = p.id
        ${whereClause}
        ORDER BY ci.category, ci.sort_order, ci.created_at
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      console.error("[Commissioning] List error:", err.message);
      res.status(500).json({ error: "Failed to fetch commissioning items" });
    }
  });

  app.get("/api/commissioning/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT ci.*, u.name as owner_name, p.project_name
        FROM commissioning_items ci
        LEFT JOIN users u ON ci.owner_user_id = u.id
        LEFT JOIN project_info p ON ci.project_id = p.id
        WHERE ci.id = ${id}
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch commissioning item" });
    }
  });

  app.post("/api/commissioning", jwtAuth, requireAuth, requirePermission("projects", "create"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
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
    } catch (err: any) {
      console.error("[Commissioning] Create error:", err.message);
      res.status(500).json({ error: "Failed to create commissioning item" });
    }
  });

  app.patch("/api/commissioning/:id", jwtAuth, requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: any = { updatedAt: new Date() };
      const fields = ['title', 'description', 'ownerUserId', 'dueDate', 'evidenceNotes', 'gateId', 'category', 'sortOrder', 'itemType'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      if (req.body.status !== undefined && req.body.status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${req.body.status}` });
        }
        updates.status = req.body.status;

        if (req.body.status === 'approved' || req.body.status === 'closed') {
          const user = (req as any).user as any;
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
            const user = (req as any).user;
            const approvalResult = await db.insert(approvals).values({
              type: old.itemType || 'commissioning',
              title: `${old.itemType === 'closeout' ? 'Closeout' : 'Commissioning'}: ${old.title}`,
              description: old.description || '',
              status: 'pending',
              requestedBy: user.id,
              projectId: old.projectId,
            }).returning();
            updates.approvalId = approvalResult[0].id;
          } catch (approvalErr: any) {
            console.warn("[Commissioning] Approval creation failed:", approvalErr.message);
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
    } catch (err: any) {
      console.error("[Commissioning] Update error:", err.message);
      res.status(500).json({ error: "Failed to update commissioning item" });
    }
  });

  app.delete("/api/commissioning/:id", jwtAuth, requireAuth, requirePermission("projects", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete commissioning item" });
    }
  });

  app.get("/api/commissioning/progress/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
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
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch progress" });
    }
  });

  app.post("/api/commissioning/:id/evidence", jwtAuth, requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [item] = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (!item) return res.status(404).json({ error: "Not found" });
      const user = (req as any).user as any;

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
    } catch (err: any) {
      console.error("[Commissioning] evidence add error:", err.message);
      res.status(500).json({ error: "Failed to add evidence" });
    }
  });

  app.get("/api/commissioning/:id/evidence-evaluation", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [item] = await db.select().from(commissioningItems).where(eq(commissioningItems.id, id));
      if (!item) return res.status(404).json({ error: "Not found" });
      const user = (req as any).user as any;
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
    } catch (err: any) {
      res.status(500).json({ error: "Failed to evaluate evidence" });
    }
  });
}
