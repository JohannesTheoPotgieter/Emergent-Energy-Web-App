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
import { parseIntParam } from "./lib/req-params";

const uploadDir = path.resolve("uploads/invoices");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
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


async function syncInvoiceCaptureToActuals(req: Request, payload: {
  invoiceCaptureId: number;
  projectId: number;
  linkedPoId: number | null;
  linkedProcurementItemId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string | number | null;
}): Promise<void> {
  const invoiceRef = payload.invoiceNumber || oldInvoiceRefFallback(payload.invoiceCaptureId);
  const invoiceDate = payload.invoiceDate || null;
  const amountNum = payload.amount == null ? null : Number(payload.amount);

  if (payload.linkedProcurementItemId && amountNum !== null && Number.isFinite(amountNum)) {
    await db.update(procurementItems)
      .set({ actualCost: String(amountNum.toFixed(2)), updatedAt: new Date() } as Record<string, unknown>)
      .where(eq(procurementItems.id, payload.linkedProcurementItemId));
  }

  if (!payload.linkedPoId || !invoiceDate) return;

  const synced = await db.execute(sql`
    WITH po AS (
      SELECT po_number
      FROM purchase_orders
      WHERE id = ${payload.linkedPoId}
      LIMIT 1
    )
    UPDATE normalized_cost_lines ncl
    SET
      invoice_number = CASE
        WHEN (ncl.invoice_number IS NULL OR btrim(ncl.invoice_number) = '') THEN ${invoiceRef}
        ELSE ncl.invoice_number
      END,
      invoice_date = CASE
        WHEN ncl.invoice_date IS NULL THEN ${invoiceDate}::date
        ELSE ncl.invoice_date
      END,
      invoice_date_confirmed = CASE
        WHEN ncl.invoice_date IS NULL THEN true
        ELSE ncl.invoice_date_confirmed
      END,
      invoice_date_font_color = CASE
        WHEN ncl.invoice_date IS NULL THEN '#2563eb'
        ELSE ncl.invoice_date_font_color
      END,
      updated_at = NOW()
    FROM po
    WHERE ncl.project_id = ${payload.projectId}
      AND ncl.effective_to IS NULL
      AND ncl.deleted_at IS NULL
      AND ncl.po_number = po.po_number
      AND ncl.manual_overrides IS NULL
    RETURNING ncl.id, ncl.po_number
  `);

  const syncedRows = rowsFromResult(synced);
  if (syncedRows.length > 0) {
    logAuditFromReq(req, {
      entityType: 'invoice_capture',
      entityId: String(payload.invoiceCaptureId),
      action: 'sync_actuals',
      changesJson: {
        target: 'normalized_cost_lines',
        syncMode: 'po_match_fill_blanks_only',
        syncedRows: syncedRows.length,
        invoiceNumber: invoiceRef,
        invoiceDate,
      },
    });
  }
}

export function registerInvoiceCaptureRoutes(app: Express): void {
  app.get("/api/invoice-captures/project/:projectId", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const rows = await db.execute(sql`
        SELECT ic.*, u.name as captured_by_name, c.name_canonical as supplier_name, p.project_name
        FROM invoice_captures ic
        LEFT JOIN users u ON ic.captured_by_user_id = u.id
        LEFT JOIN counterparties c ON ic.supplier_id = c.id
        LEFT JOIN project_info p ON ic.project_id = p.id
        WHERE ic.project_id = ${projectId} AND ic.deleted_at IS NULL
        ORDER BY ic.created_at DESC
      `);
      const items = rowsFromResult(rows);
      res.json(items);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoice-captures", jwtAuth, requireAuth, requirePermission("procurement", "edit"), upload.single("document"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const { projectId, supplierId, invoiceNumber, invoiceDate, amount, vatAmount, linkedPoId, linkedProcurementItemId, notes } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      const documentPath = req.file ? req.file.path : null;

      // Validate linked PO exists and is approved
      if (linkedPoId) {
        const poCheck = await db.execute(sql`SELECT id, status FROM purchase_orders WHERE id = ${parseInt(linkedPoId)}`);
        const poRows = rowsFromResult(poCheck);
        if (poRows.length === 0) {
          return res.status(400).json({ error: "Linked purchase order not found" });
        }
        if (poRows[0].status !== "approved") {
          return res.status(400).json({ error: `Linked PO must be approved. Current status: ${poRows[0].status}` });
        }
      }

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        action: "create_attempt",
        changesJson: { invoiceNumber, amount, projectId, linkedPoId, linkedProcurementItemId },
      });

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
        logAuditFromReq(req, {
          entityType: "procurement_item",
          entityId: String(result[0].linkedProcurementItemId),
          action: "link_invoice_capture_attempt",
          changesJson: { invoiceCaptureId: result[0].id, invoiceNumber: result[0].invoiceNumber || oldInvoiceRefFallback(result[0].id) },
        });

        await db.update(procurementItems)
          .set({
            invoiceRef: result[0].invoiceNumber || oldInvoiceRefFallback(result[0].id),
            linkedInvoiceCaptureId: result[0].id,
            paymentStatus: 'pending_approval',
            updatedAt: new Date(),
          } as Record<string, unknown>)
          .where(eq(procurementItems.id, result[0].linkedProcurementItemId));
      }


      await syncInvoiceCaptureToActuals(req, {
        invoiceCaptureId: result[0].id,
        projectId: result[0].projectId,
        linkedPoId: result[0].linkedPoId ?? null,
        linkedProcurementItemId: result[0].linkedProcurementItemId ?? null,
        invoiceNumber: result[0].invoiceNumber ?? null,
        invoiceDate: result[0].invoiceDate ?? null,
        amount: result[0].amount ?? null,
      });

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
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(invoiceCaptures).where(eq(invoiceCaptures.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      // EE-QA-PERM-006 — once an invoice is "approved", financial fields
      // (amount, vat, date, linked PO/supplier) must not change silently.
      // Without this guard a user with procurement:edit could re-state an
      // approved invoice and the new amount would propagate into project
      // actuals via syncInvoiceCaptureToActuals below. Require the request
      // to transition status off "approved" in the same call before the
      // financial fields can be edited.
      const FINANCIAL_FIELDS = ['amount', 'vatAmount', 'invoiceDate', 'linkedPoId', 'supplierId'] as const;
      if (old.status === 'approved') {
        const changedFinancials = FINANCIAL_FIELDS.filter((f) => {
          const incoming = (req.body as Record<string, unknown>)[f];
          return incoming !== undefined && incoming !== (old as Record<string, unknown>)[f];
        });
        const isMovingOffApproved = req.body.status !== undefined && req.body.status !== 'approved';
        if (changedFinancials.length > 0 && !isMovingOffApproved) {
          logAuditFromReq(req, {
            entityType: "invoice_capture",
            entityId: String(id),
            action: "update_blocked_approved_lock",
            changesJson: { blockedFields: changedFinancials, attempted: req.body },
          });
          return res.status(409).json({
            error: "approved_invoice_locked",
            message: "This invoice is approved. Move it back to a non-approved status before editing the amount, VAT, invoice date, linked PO, or supplier.",
            blockedFields: changedFinancials,
          });
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const fields = ['supplierId', 'invoiceNumber', 'invoiceDate', 'amount', 'vatAmount', 'linkedPoId', 'linkedProcurementItemId', 'status', 'notes'];
      for (const f of fields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(id),
        action: "update_attempt",
        changesJson: { updates: req.body },
      });

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
        logAuditFromReq(req, {
          entityType: "procurement_item",
          entityId: String(result[0].linkedProcurementItemId),
          action: "sync_invoice_capture_attempt",
          changesJson: { invoiceCaptureId: result[0].id, invoiceRef: result[0].invoiceNumber || old.invoiceNumber || `INV-${result[0].id}` },
        });

        await db.update(procurementItems)
          .set({
            invoiceRef: result[0].invoiceNumber || old.invoiceNumber || `INV-${result[0].id}`,
            linkedInvoiceCaptureId: result[0].id,
            updatedAt: new Date(),
          } as Record<string, unknown>)
          .where(eq(procurementItems.id, result[0].linkedProcurementItemId));
      }


      await syncInvoiceCaptureToActuals(req, {
        invoiceCaptureId: result[0].id,
        projectId: result[0].projectId,
        linkedPoId: (result[0].linkedPoId ?? old.linkedPoId) ?? null,
        linkedProcurementItemId: (result[0].linkedProcurementItemId ?? old.linkedProcurementItemId) ?? null,
        invoiceNumber: result[0].invoiceNumber ?? old.invoiceNumber ?? null,
        invoiceDate: result[0].invoiceDate ?? old.invoiceDate ?? null,
        amount: result[0].amount ?? old.amount ?? null,
      });

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

  app.delete("/api/invoice-captures/:id", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(invoiceCaptures).where(eq(invoiceCaptures.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      if (existing[0].documentPath) {
        try { fs.unlinkSync(existing[0].documentPath); } catch { /* ignore */ }
      }

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(id),
        action: "delete_attempt",
        changesJson: { invoiceNumber: existing[0].invoiceNumber },
      });

      const [deleted] = await db.update(invoiceCaptures).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(invoiceCaptures.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "invoice_capture",
        entityId: String(id),
        action: "delete",
        changesJson: { invoiceNumber: existing[0].invoiceNumber },
      });

      res.json({ success: true, record: deleted });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });
}
