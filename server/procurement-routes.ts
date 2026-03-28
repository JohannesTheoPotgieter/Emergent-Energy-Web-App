import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { procurementItems, approvals } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { createApproval } from "./services/approval-service";

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

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

export function registerProcurementRoutes(app: Express): void {
  app.get("/api/procurement/project/:projectId", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const statusFilter = req.query.status as string | undefined;
      const categoryFilter = req.query.category as string | undefined;

      const conditions = [sql`pi2.project_id = ${projectId}`];
      if (statusFilter) conditions.push(sql`pi2.status = ${statusFilter}`);
      if (categoryFilter) conditions.push(sql`pi2.category = ${categoryFilter}`);
      const whereClause = sql.join(conditions, sql` AND `);

      const rows = await db.execute(sql`
        SELECT pi2.*,
          u1.name as requested_by_name,
          u2.name as owner_name,
          c.name_canonical as supplier_name,
          p.project_name
        FROM procurement_items pi2
        LEFT JOIN users u1 ON pi2.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON pi2.owner_user_id = u2.id
        LEFT JOIN counterparties c ON pi2.supplier_id = c.id
        LEFT JOIN project_info p ON pi2.project_id = p.id
        WHERE ${whereClause}
        ORDER BY pi2.created_at DESC
      `);
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Procurement] List error:", message);
      res.status(500).json({ error: "Failed to fetch procurement items" });
    }
  });

  // Global procurement items list for Procurement Dashboard
  app.get("/api/procurement-items", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql`
        SELECT pi2.id, pi2.title, pi2.status, pi2.category, pi2.expected_cost,
          pi2.project_id, pi2.required_date, pi2.is_long_lead,
          pi2.requisition_status, pi2.delivery_status, pi2.delivery_expected_date,
          pi2.quote_amount,
          p.project_name
        FROM procurement_items pi2
        LEFT JOIN project_info p ON pi2.project_id = p.id
        ORDER BY pi2.created_at DESC
      `);
      const items = rowsFromResult(rows).map((r: any) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        requisitionStatus: r.requisition_status,
        deliveryStatus: r.delivery_status,
        deliveryExpectedDate: r.delivery_expected_date,
        isLongLead: r.is_long_lead ?? false,
        projectId: r.project_id,
        expectedCost: r.expected_cost,
        quoteAmount: r.quote_amount,
        projectName: r.project_name,
      }));
      res.json(items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Procurement] Global list error:", message);
      res.status(500).json({ error: "Failed to fetch procurement items" });
    }
  });

  app.get("/api/procurement/:id", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql`
        SELECT pi2.*, u1.name as requested_by_name, u2.name as owner_name, c.name_canonical as supplier_name, p.project_name
        FROM procurement_items pi2
        LEFT JOIN users u1 ON pi2.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON pi2.owner_user_id = u2.id
        LEFT JOIN counterparties c ON pi2.supplier_id = c.id
        LEFT JOIN project_info p ON pi2.project_id = p.id
        WHERE pi2.id = ${id}
      `);
      const items = rowsFromResult(rows);
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch procurement item" });
    }
  });

  app.post("/api/procurement", jwtAuth, requireAuth, requirePermission("procurement", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
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
        requestedByUserId: user?.id,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Procurement] Create error:", message);
      res.status(500).json({ error: "Failed to create procurement item" });
    }
  });

  app.patch("/api/procurement/:id", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(procurementItems).where(eq(procurementItems.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const fields = ['title', 'description', 'category', 'quantity', 'unit', 'expectedCost', 'actualCost', 'supplierId', 'ownerUserId', 'requiredDate', 'poId', 'invoiceRef', 'linkedTaskId', 'notes', 'budgetLine', 'linkedDeliverableId', 'linkedMilestone', 'progressPercent', 'receiptRef', 'paymentStatus', 'linkedInvoiceCaptureId',
        // C2: enriched procurement fields
        'requisitionStatus', 'rfqSentDate', 'quoteReceivedDate', 'quoteAmount', 'boqReference', 'deliveryExpectedDate', 'deliveryActualDate', 'deliveryStatus', 'isLongLead'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      // Validate poId references a real purchase_orders record (FK enforced by migration)
      if (req.body.poId !== undefined && req.body.poId !== null) {
        const poCheck = await db.execute(sql`SELECT id, status FROM purchase_orders WHERE id = ${parseInt(req.body.poId)}`);
        const poRows = rowsFromResult(poCheck);
        if (poRows.length === 0) {
          return res.status(400).json({ error: "Linked purchase order not found" });
        }
      }

      if (req.body.status !== undefined && req.body.status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${req.body.status}` });
        }
        updates.status = req.body.status;

        if (req.body.status === 'approved' && !old.approvalId) {
          try {
            const user = getEffectiveUser(req);
            // B8: Use universal approval service
            const approval = await createApproval({
              approvalType: "procurement",
              type: "procurement",
              title: `Procurement approved: ${old.title}`,
              description: `Category: ${old.category}, Expected cost: R${old.expectedCost || 'N/A'}`,
              projectId: old.projectId,
              requestedByUserId: old.requestedByUserId || user?.id || 0,
              relatedEntityType: "procurement_item",
              relatedEntityId: old.id,
              urgency: Number(old.expectedCost || 0) > 100000 ? "high" : "normal",
            });
            updates.approvalId = approval.id;
          } catch (approvalErr: unknown) {
            const msg = approvalErr instanceof Error ? approvalErr.message : String(approvalErr);
            console.warn("[Procurement] Approval creation failed:", msg);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Procurement] Update error:", message);
      res.status(500).json({ error: "Failed to update procurement item" });
    }
  });

  app.delete("/api/procurement/:id", jwtAuth, requireAuth, requirePermission("procurement", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
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
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to delete procurement item" });
    }
  });

  app.get("/api/procurement/pipeline/summary", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (_req: Request, res: Response) => {
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
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch pipeline summary" });
    }
  });
}
