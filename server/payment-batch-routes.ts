import { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requirePermission } from "./permission-middleware";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { logAuditFromReq } from "./audit-logger";
import { createPaymentReleaseApproval } from "./services/approval-service";

// ===================== PAYMENT BATCH STATE MACHINE =====================

const VALID_TRANSITIONS: Record<string, string[]> = {
  preparing: ["submitted"],
  submitted: ["approved"],
  approved: ["released"],
  released: ["confirmed"],
};

// Roles that can approve payment batches (ManCo)
const MANCO_ROLES = ["COO_ADMIN", "CEO_ADMIN", "CFO"];

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

function generateBatchNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `BATCH-${dateStr}-${seq}`;
}

export function registerPaymentBatchRoutes(app: Express) {

  // ===================== LIST BATCHES =====================

  app.get("/api/payment-batches", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql`
        SELECT pb.*,
               up.name as prepared_by_name,
               ua.name as approved_by_name,
               ur.name as released_by_name
        FROM payment_batches pb
        LEFT JOIN users up ON pb.prepared_by_user_id = up.id
        LEFT JOIN users ua ON pb.approved_by_user_id = ua.id
        LEFT JOIN users ur ON pb.released_by_user_id = ur.id
        ORDER BY pb.created_at DESC
      `);
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[PaymentBatch] List error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to list payment batches" });
    }
  });

  // ===================== GET BATCH DETAIL =====================

  app.get("/api/payment-batches/:id", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const batchResult = await db.execute(sql`
        SELECT pb.*,
               up.name as prepared_by_name,
               ua.name as approved_by_name,
               ur.name as released_by_name
        FROM payment_batches pb
        LEFT JOIN users up ON pb.prepared_by_user_id = up.id
        LEFT JOIN users ua ON pb.approved_by_user_id = ua.id
        LEFT JOIN users ur ON pb.released_by_user_id = ur.id
        WHERE pb.id = ${id}
      `);
      const batch = rowsFromResult(batchResult)[0];
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const itemsResult = await db.execute(sql`
        SELECT pbi.*, pr.project_id, pr.status as request_status, pr.amount as request_amount,
               pr.due_date, pr.notes as request_notes,
               p.project_name, c.name_canonical as counterparty_name,
               po.po_ref, ic.invoice_number
        FROM payment_batch_items pbi
        JOIN payment_requests pr ON pbi.payment_request_id = pr.id
        LEFT JOIN project_info p ON pr.project_id = p.id
        LEFT JOIN counterparties c ON pr.counterparty_id = c.id
        LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
        LEFT JOIN invoice_captures ic ON pr.invoice_capture_id = ic.id
        WHERE pbi.payment_batch_id = ${id}
        ORDER BY pbi.created_at ASC
      `);

      const popResult = await db.execute(sql`
        SELECT * FROM proof_of_payment WHERE payment_batch_id = ${id}
      `);

      res.json({
        ...batch,
        items: rowsFromResult(itemsResult),
        proofOfPayment: rowsFromResult(popResult),
      });
    } catch (err: unknown) {
      console.error("[PaymentBatch] Detail error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load batch detail" });
    }
  });

  // ===================== CREATE BATCH =====================

  app.post("/api/payment-batches", jwtAuth, requireAuth, requirePermission("procurement", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const { cutoffDate, paymentRequestIds, notes } = req.body;

      if (!cutoffDate || !paymentRequestIds?.length) {
        return res.status(400).json({ error: "cutoffDate and paymentRequestIds are required" });
      }

      const batchNumber = generateBatchNumber();

      // Validate all payment requests exist and are in 'loaded_for_payment' status
      const prIds = paymentRequestIds.map((id: unknown) => parseInt(String(id)));
      const prResult = await db.execute(sql.raw(`
        SELECT id, amount, status FROM payment_requests WHERE id IN (${prIds.join(",")})
      `));
      const prs = rowsFromResult(prResult);

      const invalidPrs = prs.filter(pr => pr.status !== "loaded_for_payment");
      if (invalidPrs.length > 0) {
        return res.status(400).json({
          error: `Payment requests must be in 'loaded_for_payment' status. Invalid IDs: ${invalidPrs.map(p => p.id).join(", ")}`,
        });
      }

      if (prs.length !== prIds.length) {
        return res.status(400).json({ error: "Some payment request IDs not found" });
      }

      const totalAmount = prs.reduce((sum, pr) => sum + (Number(pr.amount) || 0), 0);

      // Create batch
      const batchResult = await db.execute(sql`
        INSERT INTO payment_batches (batch_number, cutoff_date, total_amount, item_count, status, prepared_by_user_id, notes)
        VALUES (${batchNumber}, ${cutoffDate}, ${totalAmount}, ${prs.length}, 'preparing', ${user.id}, ${notes || null})
        RETURNING *
      `);
      const batch = rowsFromResult(batchResult)[0];
      const batchId = Number(batch?.id);

      // Create batch items
      for (const pr of prs) {
        await db.execute(sql`
          INSERT INTO payment_batch_items (payment_batch_id, payment_request_id, amount)
          VALUES (${batchId}, ${Number(pr.id)}, ${Number(pr.amount)})
        `);
      }

      logAuditFromReq(req, {
        entityType: "payment_batch",
        entityId: String(batchId),
        action: "create",
        changesJson: { batchNumber, totalAmount, itemCount: prs.length },
      });

      res.json(batch);
    } catch (err: unknown) {
      console.error("[PaymentBatch] Create error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to create payment batch" });
    }
  });

  // ===================== SUBMIT BATCH FOR MANCO APPROVAL =====================

  app.post("/api/payment-batches/:id/submit", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const batchResult = await db.execute(sql`SELECT * FROM payment_batches WHERE id = ${id}`);
      const batch = rowsFromResult(batchResult)[0];
      if (!batch) return res.status(404).json({ error: "Batch not found" });
      if (batch.status !== "preparing") {
        return res.status(400).json({ error: `Batch must be in 'preparing' status. Current: ${batch.status}` });
      }

      // Create ManCo release approval (use first project from batch items for projectId)
      const firstItemResult = await db.execute(sql`
        SELECT pr.project_id FROM payment_batch_items pbi
        JOIN payment_requests pr ON pbi.payment_request_id = pr.id
        WHERE pbi.payment_batch_id = ${id} LIMIT 1
      `);
      const firstItem = rowsFromResult(firstItemResult)[0];
      const projectId = Number(firstItem?.project_id) || 0;

      const approval = await createPaymentReleaseApproval({
        projectId,
        paymentBatchId: id,
        requestedByUserId: user.id,
        totalAmount: Number(batch.total_amount) || 0,
        batchNumber: String(batch.batch_number),
      });

      await db.execute(sql`
        UPDATE payment_batches SET status = 'submitted', approval_id = ${approval.id}, updated_at = NOW()
        WHERE id = ${id}
      `);

      logAuditFromReq(req, {
        entityType: "payment_batch",
        entityId: String(id),
        action: "submit_for_approval",
        changesJson: { approvalId: approval.id },
      });

      res.json({ success: true, approvalId: approval.id });
    } catch (err: unknown) {
      console.error("[PaymentBatch] Submit error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to submit batch for approval" });
    }
  });

  // ===================== APPROVE BATCH (ManCo) =====================

  app.post("/api/payment-batches/:id/approve", jwtAuth, requireAuth, requirePermission("procurement", "approve"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      // Verify ManCo role
      if (!MANCO_ROLES.includes(user.role || "")) {
        return res.status(403).json({ error: "Only ManCo members can approve payment batches" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const batchResult = await db.execute(sql`SELECT status FROM payment_batches WHERE id = ${id}`);
      const batch = rowsFromResult(batchResult)[0];
      if (!batch) return res.status(404).json({ error: "Batch not found" });
      if (batch.status !== "submitted") {
        return res.status(400).json({ error: `Batch must be 'submitted'. Current: ${batch.status}` });
      }

      await db.execute(sql`
        UPDATE payment_batches SET status = 'approved', approved_by_user_id = ${user.id}, approved_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `);

      logAuditFromReq(req, {
        entityType: "payment_batch",
        entityId: String(id),
        action: "approve",
        changesJson: { approvedByUserId: user.id },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("[PaymentBatch] Approve error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to approve batch" });
    }
  });

  // ===================== RELEASE BATCH =====================

  app.post("/api/payment-batches/:id/release", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const batchResult = await db.execute(sql`SELECT status FROM payment_batches WHERE id = ${id}`);
      const batch = rowsFromResult(batchResult)[0];
      if (!batch) return res.status(404).json({ error: "Batch not found" });
      if (batch.status !== "approved") {
        return res.status(400).json({ error: `Batch must be 'approved'. Current: ${batch.status}` });
      }

      await db.execute(sql`
        UPDATE payment_batches SET status = 'released', released_by_user_id = ${user.id}, released_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `);

      logAuditFromReq(req, {
        entityType: "payment_batch",
        entityId: String(id),
        action: "release",
        changesJson: { releasedByUserId: user.id },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("[PaymentBatch] Release error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to release batch" });
    }
  });

  // ===================== CONFIRM BATCH (with proof) =====================

  app.post("/api/payment-batches/:id/confirm", jwtAuth, requireAuth, requirePermission("procurement", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const { bankReference, documentDriveId, documentItemId, documentUrl, notes } = req.body;

      const batchResult = await db.execute(sql`SELECT status FROM payment_batches WHERE id = ${id}`);
      const batch = rowsFromResult(batchResult)[0];
      if (!batch) return res.status(404).json({ error: "Batch not found" });
      if (batch.status !== "released") {
        return res.status(400).json({ error: `Batch must be 'released'. Current: ${batch.status}` });
      }

      // Create proof of payment
      await db.execute(sql`
        INSERT INTO proof_of_payment (payment_batch_id, bank_reference, document_drive_id, document_item_id, document_url, uploaded_by_user_id, confirmed_at, notes)
        VALUES (${id}, ${bankReference || null}, ${documentDriveId || null}, ${documentItemId || null}, ${documentUrl || null}, ${user.id}, NOW(), ${notes || null})
      `);

      // Update batch status
      await db.execute(sql`
        UPDATE payment_batches SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `);

      // Update all payment requests in this batch to 'complete'
      await db.execute(sql`
        UPDATE payment_requests SET status = 'complete', updated_at = NOW()
        WHERE id IN (SELECT payment_request_id FROM payment_batch_items WHERE payment_batch_id = ${id})
      `);

      logAuditFromReq(req, {
        entityType: "payment_batch",
        entityId: String(id),
        action: "confirm",
        changesJson: { bankReference, confirmedByUserId: user.id },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("[PaymentBatch] Confirm error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to confirm batch" });
    }
  });
}
