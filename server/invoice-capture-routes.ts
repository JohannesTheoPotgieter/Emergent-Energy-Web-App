import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { invoiceCaptures, procurementItems } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import multer from "multer";
import path from "path";
import fs from "fs";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";

const uploadDir = path.resolve("uploads/invoices");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: allowedFileFilter,
});

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

function oldInvoiceRefFallback(id: number): string {
  return `INV-${id}`;
}

export function registerInvoiceCaptureRoutes(app: Express): void {
  app.get("/api/invoice-captures/project/:projectId", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const rows = await db.execute(sql.raw(`
        SELECT ic.*, u.name as captured_by_name, c.name_canonical as supplier_name, p.project_name
        FROM invoice_captures ic
        LEFT JOIN users u ON ic.captured_by_user_id = u.id
        LEFT JOIN counterparties c ON ic.supplier_id = c.id
        LEFT JOIN project_info p ON ic.project_id = p.id
        WHERE ic.project_id = ${projectId}
        ORDER BY ic.created_at DESC
      `));
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoice-captures", jwtAuth, requireAuth, requirePermission("procurement", "create"), upload.single("document"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const { projectId, supplierId, invoiceNumber, invoiceDate, amount, vatAmount, linkedPoId, linkedProcurementItemId, notes } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      const documentPath = req.file ? req.file.path : null;

      // Validate linked PO exists and is approved
      if (linkedPoId) {
        const poCheck = await db.execute(sql.raw(`SELECT id, status FROM purchase_orders WHERE id = ${parseInt(linkedPoId)}`));
        const poRows = rowsFromResult(poCheck);
        if (poRows.length === 0) {
          return res.status(400).json({ error: "Linked purchase order not found" });
        }
        if (poRows[0].status !== "approved") {
          return res.status(400).json({ error: `Linked PO must be approved. Current status: ${poRows[0].status}` });
        }
      }

      const result = await db.insert(invoiceCaptures).values({
        projectId: parseInt(projectId),
        supplierId: supplierId ? parseInt(supplierId) : null,
        invoiceNumber: invoiceNumber || null,
        invoiceDate: invoiceDate || null,
        amount: amount ? parseFloat(amount) : null,
        vatAmount: vatAmount ? parseFloat(vatAmount) : null,
        linkedPoId: linkedPoId ? parseInt(linkedPoId) : null,
        linkedProcurementItemId: linkedProcurementItemId ? parseInt(linkedProcurementItemId) : null,
        status: 'captured',
        capturedByUserId: user?.id,
        documentPath,
        notes: notes || null,
      }).returning();


      if (result[0].linkedProcurementItemId) {
        await db.update(procurementItems)
          .set({
            invoiceRef: result[0].invoiceNumber || oldInvoiceRefFallback(result[0].id),
            linkedInvoiceCaptureId: result[0].id,
            paymentStatus: 'pending_approval',
            updatedAt: new Date(),
          } as Record<string, unknown>)
          .where(eq(procurementItems.id, result[0].linkedProcurementItemId));
      }

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(result[0].id),
        action: "create",
        changesJson: { invoiceNumber, amount, projectId },
      });

      const actor = actorFromReq(req);
      await createProjectEvent({
        projectId: result[0].projectId,
        eventType: "invoice.captured",
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        sourceEntityType: "invoice_captures",
        sourceEntityId: String(result[0].id),
        summary: `Invoice captured${result[0].invoiceNumber ? `: ${result[0].invoiceNumber}` : ""}`,
        details: { amount: result[0].amount, status: result[0].status, linkedProcurementItemId: result[0].linkedProcurementItemId },
        idempotencyKey: `invoice-captured:${result[0].id}`,
      });

      res.status(201).json(result[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[InvoiceCapture] Create error:", message);
      res.status(500).json({ error: "Failed to capture invoice" });
    }
  });

  app.patch("/api/invoice-captures/:id", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(invoiceCaptures).where(eq(invoiceCaptures.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const fields = ['supplierId', 'invoiceNumber', 'invoiceDate', 'amount', 'vatAmount', 'linkedPoId', 'linkedProcurementItemId', 'status', 'notes'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      const result = await db.update(invoiceCaptures).set(updates).where(eq(invoiceCaptures.id, id)).returning();

      if (updates.status && updates.status !== old.status) {
        const actor = actorFromReq(req);
        const eventType = updates.status === "approved" ? "invoice.approved" : "invoice.payment_status_changed";
        await createProjectEvent({
          projectId: old.projectId,
          eventType,
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "invoice_captures",
          sourceEntityId: String(id),
          summary: `Invoice status changed: ${old.status} → ${updates.status}`,
          details: { fromStatus: old.status, toStatus: updates.status, invoiceNumber: result[0].invoiceNumber || old.invoiceNumber || null },
          idempotencyKey: `invoice-status:${id}:${old.status}:${updates.status}`,
        });
      }

      if (result[0].linkedProcurementItemId) {
        await db.update(procurementItems)
          .set({
            invoiceRef: result[0].invoiceNumber || old.invoiceNumber || `INV-${result[0].id}`,
            linkedInvoiceCaptureId: result[0].id,
            updatedAt: new Date(),
          } as Record<string, unknown>)
          .where(eq(procurementItems.id, result[0].linkedProcurementItemId));
      }

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(id),
        action: "update",
        changesJson: { before: { status: old.status }, after: { status: result[0].status }, updates: req.body },
      });

      res.json(result[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete("/api/invoice-captures/:id", jwtAuth, requireAuth, requirePermission("procurement", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(invoiceCaptures).where(eq(invoiceCaptures.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      if (existing[0].documentPath) {
        try { fs.unlinkSync(existing[0].documentPath); } catch { /* ignore */ }
      }

      await db.delete(invoiceCaptures).where(eq(invoiceCaptures.id, id));

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(id),
        action: "delete",
        changesJson: { invoiceNumber: existing[0].invoiceNumber },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });
}
