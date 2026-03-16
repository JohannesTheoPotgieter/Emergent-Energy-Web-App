import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { procurementItems, projectInfo, users, counterparties, approvals, invoiceCaptures } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";

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
  requested: ['quoted', 'approved', 'closed'],
  quoted: ['approved', 'closed'],
  approved: ['ordered', 'closed'],
  ordered: ['partially_received', 'received', 'closed'],
  partially_received: ['received', 'closed'],
  received: ['invoiced', 'closed'],
  invoiced: ['closed'],
  closed: [],
};


export function registerProcurementRoutes(app: Express) {
  app.get("/api/procurement/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const statusFilter = req.query.status as string | undefined;
      const categoryFilter = req.query.category as string | undefined;

      let whereClause = `WHERE pi2.project_id = ${projectId}`;
      if (statusFilter) whereClause += ` AND pi2.status = '${statusFilter}'`;
      if (categoryFilter) whereClause += ` AND pi2.category = '${categoryFilter}'`;

      const rows = await db.execute(sql.raw(`
        SELECT pi2.*,
          u1.name as requested_by_name,
          u2.name as owner_name,
          c.name_canonical as supplier_name,
          p.project_name,
          ic.invoice_number as linked_invoice_number,
          ic.status as linked_invoice_status
        FROM procurement_items pi2
        LEFT JOIN users u1 ON pi2.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON pi2.owner_user_id = u2.id
        LEFT JOIN counterparties c ON pi2.supplier_id = c.id
        LEFT JOIN project_info p ON pi2.project_id = p.id
        LEFT JOIN invoice_captures ic ON pi2.linked_invoice_capture_id = ic.id
        ${whereClause}
        ORDER BY pi2.created_at DESC
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      console.error("[Procurement] List error:", err.message);
      res.status(500).json({ error: "Failed to fetch procurement items" });
    }
  });

  app.get("/api/procurement/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT pi2.*, u1.name as requested_by_name, u2.name as owner_name, c.name_canonical as supplier_name, p.project_name, ic.invoice_number as linked_invoice_number, ic.status as linked_invoice_status
        FROM procurement_items pi2
        LEFT JOIN users u1 ON pi2.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON pi2.owner_user_id = u2.id
        LEFT JOIN counterparties c ON pi2.supplier_id = c.id
        LEFT JOIN project_info p ON pi2.project_id = p.id
        LEFT JOIN invoice_captures ic ON pi2.linked_invoice_capture_id = ic.id
        WHERE pi2.id = ${id}
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch procurement item" });
    }
  });

  app.post("/api/procurement", jwtAuth, requireAuth, requirePermission("procurement", "create"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { projectId, title, description, category, quantity, unit, expectedCost, supplierId, ownerUserId, requiredDate, linkedTaskId, notes, budgetLine, linkedDeliverableId, linkedMilestone, progressPercent, receiptRef, paymentStatus } = req.body;
      if (!projectId || !title) return res.status(400).json({ error: "projectId and title required" });

      const result = await db.insert(procurementItems).values({
        projectId,
        title,
        description: description || null,
        category: category || 'other',
        quantity: quantity || null,
        unit: unit || null,
        expectedCost: expectedCost || null,
        supplierId: supplierId || null,
        requestedByUserId: user.id,
        ownerUserId: ownerUserId || null,
        status: 'requested',
        requiredDate: requiredDate || null,
        linkedTaskId: linkedTaskId || null,
        notes: notes || null,
        budgetLine: budgetLine || null,
        linkedDeliverableId: linkedDeliverableId || null,
        linkedMilestone: linkedMilestone || null,
        progressPercent: progressPercent || null,
        receiptRef: receiptRef || null,
        paymentStatus: paymentStatus || 'not_applicable',
      }).returning();

      logAuditFromReq(req, {
        entityType: "procurement_item",
        entityId: String(result[0].id),
        action: "create",
        changesJson: { title, category, projectId, expectedCost },
      });

      const actor = actorFromReq(req);
      await createProjectEvent({
        projectId: result[0].projectId,
        eventType: "procurement.item_created",
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        sourceEntityType: "procurement_items",
        sourceEntityId: String(result[0].id),
        summary: `Procurement item created: ${result[0].title}`,
        details: { category: result[0].category, expectedCost: result[0].expectedCost, status: result[0].status },
        idempotencyKey: `procurement-created:${result[0].id}`,
      });

      res.status(201).json(result[0]);
    } catch (err: any) {
      console.error("[Procurement] Create error:", err.message);
      res.status(500).json({ error: "Failed to create procurement item" });
    }
  });

  app.patch("/api/procurement/:id", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(procurementItems).where(eq(procurementItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: any = { updatedAt: new Date() };
      const fields = ['title', 'description', 'category', 'quantity', 'unit', 'expectedCost', 'actualCost', 'supplierId', 'ownerUserId', 'requiredDate', 'poId', 'invoiceRef', 'linkedTaskId', 'notes', 'budgetLine', 'linkedDeliverableId', 'linkedMilestone', 'progressPercent', 'receiptRef', 'paymentStatus', 'linkedInvoiceCaptureId'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      if (req.body.status !== undefined && req.body.status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${req.body.status}` });
        }
        updates.status = req.body.status;

        if (req.body.status === 'approved' && !old.approvalId) {
          try {
            const user = (req as any).user;
            const approvalResult = await db.insert(approvals).values({
              type: 'procurement',
              title: `Procurement: ${old.title}`,
              description: `Category: ${old.category}, Expected cost: ${old.expectedCost || 'N/A'}`,
              status: 'approved',
              requestedBy: old.requestedByUserId || user.id,
              decidedBy: user.id,
              decidedAt: new Date(),
            }).returning();
            updates.approvalId = approvalResult[0].id;
          } catch (approvalErr: any) {
            console.warn("[Procurement] Approval creation failed:", approvalErr.message);
          }
        }
      }

      const result = await db.update(procurementItems).set(updates).where(eq(procurementItems.id, id)).returning();

      if (updates.status && updates.status !== old.status) {
        const actor = actorFromReq(req);
        const eventType = updates.status === "ordered" ? "procurement.po_issued" : updates.status === "received" ? "procurement.delivery_captured" : "procurement.status_changed";
        await createProjectEvent({
          projectId: old.projectId,
          eventType,
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "procurement_items",
          sourceEntityId: String(id),
          summary: `Procurement status changed: ${old.status} → ${updates.status}`,
          details: { fromStatus: old.status, toStatus: updates.status, title: old.title },
          idempotencyKey: `procurement-status:${id}:${old.status}:${updates.status}`,
        });
      }

      logAuditFromReq(req, {
        entityType: "procurement_item",
        entityId: String(id),
        action: "update",
        changesJson: { before: { status: old.status }, after: { status: result[0].status }, updates: req.body },
      });

      res.json(result[0]);
    } catch (err: any) {
      console.error("[Procurement] Update error:", err.message);
      res.status(500).json({ error: "Failed to update procurement item" });
    }
  });

  app.delete("/api/procurement/:id", jwtAuth, requireAuth, requirePermission("procurement", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(procurementItems).where(eq(procurementItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      await db.delete(procurementItems).where(eq(procurementItems.id, id));

      logAuditFromReq(req, {
        entityType: "procurement_item",
        entityId: String(id),
        action: "delete",
        changesJson: { title: existing[0].title, status: existing[0].status },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete procurement item" });
    }
  });

  app.get("/api/procurement/pipeline/summary", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT pi2.status, pi2.category, COUNT(*)::int as count,
          COALESCE(SUM(pi2.expected_cost), 0)::real as total_expected,
          COALESCE(SUM(pi2.actual_cost), 0)::real as total_actual,
          p.project_name
        FROM procurement_items pi2
        JOIN project_info p ON pi2.project_id = p.id
        GROUP BY pi2.status, pi2.category, p.project_name
        ORDER BY p.project_name, pi2.status
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch pipeline summary" });
    }
  });
}
