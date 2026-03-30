import { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requirePermission } from "./permission-middleware";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { logAuditFromReq } from "./audit-logger";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";

// ===================== PAYMENT REQUEST STATE MACHINE =====================

const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["in_review"],
  in_review: ["loaded_for_payment", "requires_info", "blocked"],
  requires_info: ["new"],
  blocked: ["new"],
  loaded_for_payment: ["proof_attached"],
  proof_attached: ["complete"],
};

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

/**
 * Get the Tuesday 17:00 SAST cutoff for the current week.
 * Submissions before this time go into the current week's batch.
 * Late submissions roll to next week.
 */
function getWeeklyCutoff(refDate: Date = new Date()): Date {
  const d = new Date(refDate);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue...
  const diff = (2 - day + 7) % 7; // days until next Tuesday (0 if already Tuesday)
  d.setUTCDate(d.getUTCDate() + (diff === 0 && d.getUTCHours() >= 15 ? 7 : diff)); // 15:00 UTC = 17:00 SAST
  d.setUTCHours(15, 0, 0, 0); // Tuesday 17:00 SAST = 15:00 UTC
  return d;
}

function getCutoffDateString(refDate: Date = new Date()): string {
  return getWeeklyCutoff(refDate).toISOString().slice(0, 10);
}

export function registerPaymentRequestRoutes(app: Express) {

  // ===================== LIST PAYMENT REQUESTS =====================

  app.get("/api/payment-requests", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const { projectId, status, cutoffDate } = req.query;
      const conditions: string[] = ["1=1"];
      if (projectId) conditions.push(`pr.project_id = ${parseInt(String(projectId))}`);
      if (status) conditions.push(`pr.status = '${String(status).replace(/'/g, "''")}'`);
      if (cutoffDate) conditions.push(`pr.cutoff_date = '${String(cutoffDate).replace(/'/g, "''")}'`);

      const rows = await db.execute(sql.raw(`
        SELECT pr.*,
               p.project_name, p.project_code,
               c.name_canonical as counterparty_name,
               u.name as submitted_by_name,
               po.po_ref,
               ic.invoice_number
        FROM payment_requests pr
        LEFT JOIN project_info p ON pr.project_id = p.id
        LEFT JOIN counterparties c ON pr.counterparty_id = c.id
        LEFT JOIN users u ON pr.submitted_by_user_id = u.id
        LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
        LEFT JOIN invoice_captures ic ON pr.invoice_capture_id = ic.id
        WHERE ${conditions.join(" AND ")}
        ORDER BY pr.created_at DESC
      `));
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[PaymentRequest] List error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to list payment requests" });
    }
  });

  // ===================== PAYMENT REQUEST BOARD =====================

  app.get("/api/payment-requests/board", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT pr.*,
               p.project_name,
               c.name_canonical as counterparty_name,
               u.name as submitted_by_name,
               po.po_ref,
               ic.invoice_number,
               (SELECT COUNT(*) FROM proof_of_payment pop WHERE pop.payment_request_id = pr.id) as proof_count
        FROM payment_requests pr
        LEFT JOIN project_info p ON pr.project_id = p.id
        LEFT JOIN counterparties c ON pr.counterparty_id = c.id
        LEFT JOIN users u ON pr.submitted_by_user_id = u.id
        LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
        LEFT JOIN invoice_captures ic ON pr.invoice_capture_id = ic.id
        ORDER BY pr.created_at DESC
      `));

      const cutoff = getCutoffDateString();
      res.json({ requests: rowsFromResult(rows), currentCutoff: cutoff });
    } catch (err: unknown) {
      console.error("[PaymentRequest] Board error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load payment request board" });
    }
  });

  // ===================== CREATE PAYMENT REQUEST =====================

  app.post("/api/payment-requests", jwtAuth, requireAuth, requirePermission("procurement", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const { projectId, purchaseOrderId, invoiceCaptureId, counterpartyId, procurementItemId, amount, dueDate, notes } = req.body;

      if (!projectId || !amount) {
        return res.status(400).json({ error: "projectId and amount are required" });
      }

      // Validate PO is approved if provided
      if (purchaseOrderId) {
        const poResult = await db.execute(sql.raw(`SELECT status FROM purchase_orders WHERE id = ${parseInt(purchaseOrderId)}`));
        const po = rowsFromResult(poResult)[0];
        if (!po) return res.status(400).json({ error: "Purchase order not found" });
        if (po.status !== "approved") {
          return res.status(400).json({ error: `Purchase order must be approved. Current status: ${po.status}` });
        }
      }

      // Validate invoice is approved if provided
      if (invoiceCaptureId) {
        const icResult = await db.execute(sql.raw(`SELECT status FROM invoice_captures WHERE id = ${parseInt(invoiceCaptureId)}`));
        const ic = rowsFromResult(icResult)[0];
        if (!ic) return res.status(400).json({ error: "Invoice capture not found" });
        if (ic.status !== "approved" && ic.status !== "verified") {
          return res.status(400).json({ error: `Invoice must be approved or verified. Current status: ${ic.status}` });
        }
      }

      const cutoff = getCutoffDateString();

      const result = await db.execute(sql`
        INSERT INTO payment_requests (
          project_id, purchase_order_id, invoice_capture_id, counterparty_id,
          procurement_item_id, amount, due_date, status, submitted_by_user_id,
          cutoff_date, notes
        ) VALUES (
          ${parseInt(projectId)}, ${purchaseOrderId ? parseInt(purchaseOrderId) : null},
          ${invoiceCaptureId ? parseInt(invoiceCaptureId) : null},
          ${counterpartyId ? parseInt(counterpartyId) : null},
          ${procurementItemId ? parseInt(procurementItemId) : null},
          ${parseFloat(amount)}, ${dueDate || null}, 'new', ${user.id},
          ${cutoff}, ${notes || null}
        ) RETURNING *
      `);

      const created = rowsFromResult(result)[0];

      logAuditFromReq(req, {
        entityType: "payment_request",
        entityId: String(created?.id),
        action: "create",
        changesJson: { projectId, amount, purchaseOrderId, invoiceCaptureId },
      });

      const actor = actorFromReq(req);
      createProjectEvent({
        projectId: parseInt(projectId),
        eventType: "project.payment_request_created",
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        sourceEntityType: "payment_request",
        sourceEntityId: String(created?.id),
        summary: `Payment request created for R${parseFloat(amount).toLocaleString()}`,
        details: { paymentRequestId: created?.id, amount: parseFloat(amount) },
        idempotencyKey: `payment-request-${created?.id}-${Date.now()}`,
      });

      res.json(created);
    } catch (err: unknown) {
      console.error("[PaymentRequest] Create error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to create payment request" });
    }
  });

  // ===================== UPDATE PAYMENT REQUEST STATUS =====================

  app.patch("/api/payment-requests/:id/status", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const { status, notes } = req.body;

      // Get current status
      const current = await db.execute(sql`SELECT status, project_id FROM payment_requests WHERE id = ${id}`);
      const pr = rowsFromResult(current)[0];
      if (!pr) return res.status(404).json({ error: "Payment request not found" });

      const currentStatus = String(pr.status);
      const allowed = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Invalid transition from '${currentStatus}' to '${status}'. Allowed: ${allowed.join(", ") || "none"}`,
        });
      }

      await db.execute(sql`
        UPDATE payment_requests SET status = ${status}, notes = COALESCE(${notes || null}, notes), updated_at = NOW()
        WHERE id = ${id}
      `);

      logAuditFromReq(req, {
        entityType: "payment_request",
        entityId: String(id),
        action: "update_status",
        changesJson: { from: currentStatus, to: status },
      });

      res.json({ success: true, newStatus: status });
    } catch (err: unknown) {
      console.error("[PaymentRequest] Status update error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to update payment request status" });
    }
  });

  // ===================== REVIEW PAYMENT REQUEST =====================

  app.post("/api/payment-requests/:id/review", jwtAuth, requireAuth, requirePermission("procurement", "approve"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const { decision, notes } = req.body;
      const validDecisions = ["loaded_for_payment", "requires_info", "blocked"];
      if (!validDecisions.includes(decision)) {
        return res.status(400).json({ error: `Invalid decision. Must be: ${validDecisions.join(", ")}` });
      }

      // Verify it's in_review
      const current = await db.execute(sql`SELECT status, project_id FROM payment_requests WHERE id = ${id}`);
      const pr = rowsFromResult(current)[0];
      if (!pr) return res.status(404).json({ error: "Payment request not found" });
      if (pr.status !== "in_review") {
        return res.status(400).json({ error: `Payment request must be 'in_review' to review. Current: ${pr.status}` });
      }

      await db.execute(sql`
        UPDATE payment_requests SET status = ${decision}, notes = COALESCE(${notes || null}, notes), updated_at = NOW()
        WHERE id = ${id}
      `);

      logAuditFromReq(req, {
        entityType: "payment_request",
        entityId: String(id),
        action: "review",
        changesJson: { decision, reviewerUserId: user?.id },
      });

      res.json({ success: true, newStatus: decision });
    } catch (err: unknown) {
      console.error("[PaymentRequest] Review error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to review payment request" });
    }
  });

  // ===================== GET SINGLE PAYMENT REQUEST =====================

  app.get("/api/payment-requests/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const rows = await db.execute(sql`
        SELECT pr.*,
               p.project_name,
               c.name_canonical as counterparty_name,
               u.name as submitted_by_name,
               po.po_ref, po.total as po_total,
               ic.invoice_number, ic.amount as invoice_amount
        FROM payment_requests pr
        LEFT JOIN project_info p ON pr.project_id = p.id
        LEFT JOIN counterparties c ON pr.counterparty_id = c.id
        LEFT JOIN users u ON pr.submitted_by_user_id = u.id
        LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
        LEFT JOIN invoice_captures ic ON pr.invoice_capture_id = ic.id
        WHERE pr.id = ${id}
      `);
      const pr = rowsFromResult(rows)[0];
      if (!pr) return res.status(404).json({ error: "Payment request not found" });

      // Get proof of payment if any
      const popRows = await db.execute(sql`
        SELECT * FROM proof_of_payment WHERE payment_request_id = ${id}
      `);

      res.json({ ...pr, proofOfPayment: rowsFromResult(popRows) });
    } catch (err: unknown) {
      console.error("[PaymentRequest] Get error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to get payment request" });
    }
  });
}
