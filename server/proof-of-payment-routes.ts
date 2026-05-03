import { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requirePermission } from "./permission-middleware";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { logAuditFromReq } from "./audit-logger";
import { parseIntParam } from "./lib/req-params";

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

export function registerProofOfPaymentRoutes(app: Express) {

  // ===================== UPLOAD PROOF FOR A PAYMENT REQUEST =====================

  app.post("/api/proof-of-payment", jwtAuth, requireAuth, requirePermission("procurement", "create"), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const { paymentRequestId, paymentBatchId, bankReference, documentDriveId, documentItemId, documentUrl, notes } = req.body;

      if (!paymentRequestId && !paymentBatchId) {
        return res.status(400).json({ error: "Either paymentRequestId or paymentBatchId is required" });
      }

      const result = await db.execute(sql`
        INSERT INTO proof_of_payment (
          payment_request_id, payment_batch_id, bank_reference,
          document_drive_id, document_item_id, document_url,
          uploaded_by_user_id, confirmed_at, notes
        ) VALUES (
          ${paymentRequestId ? parseInt(paymentRequestId) : null},
          ${paymentBatchId ? parseInt(paymentBatchId) : null},
          ${bankReference || null},
          ${documentDriveId || null}, ${documentItemId || null}, ${documentUrl || null},
          ${user.id}, NOW(), ${notes || null}
        ) RETURNING *
      `);

      const created = rowsFromResult(result)[0];

      // If attached to a payment request, update its status to proof_attached
      if (paymentRequestId) {
        await db.execute(sql`
          UPDATE payment_requests SET status = 'proof_attached', updated_at = NOW()
          WHERE id = ${parseInt(paymentRequestId)} AND status = 'loaded_for_payment'
        `);
      }

      logAuditFromReq(req, {
        entityType: "proof_of_payment",
        entityId: String(created?.id),
        action: "create",
        changesJson: { paymentRequestId, paymentBatchId, bankReference },
      });

      res.json(created);
    } catch (err: unknown) {
      console.error("[ProofOfPayment] Create error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to upload proof of payment" });
    }
  });

  // ===================== GET PROOF BY PAYMENT REQUEST =====================

  app.get("/api/proof-of-payment/request/:paymentRequestId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const prId = parseIntParam(req.params.paymentRequestId);
      if (isNaN(prId)) return res.status(400).json({ error: "Invalid ID" });

      const rows = await db.execute(sql`
        SELECT pop.*, u.name as uploaded_by_name
        FROM proof_of_payment pop
        LEFT JOIN users u ON pop.uploaded_by_user_id = u.id
        WHERE pop.payment_request_id = ${prId}
        ORDER BY pop.created_at DESC
      `);
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[ProofOfPayment] Get by request error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to get proof of payment" });
    }
  });

  // ===================== GET PROOF BY BATCH =====================

  app.get("/api/proof-of-payment/batch/:paymentBatchId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const batchId = parseIntParam(req.params.paymentBatchId);
      if (isNaN(batchId)) return res.status(400).json({ error: "Invalid ID" });

      const rows = await db.execute(sql`
        SELECT pop.*, u.name as uploaded_by_name
        FROM proof_of_payment pop
        LEFT JOIN users u ON pop.uploaded_by_user_id = u.id
        WHERE pop.payment_batch_id = ${batchId}
        ORDER BY pop.created_at DESC
      `);
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[ProofOfPayment] Get by batch error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to get proof of payment" });
    }
  });
}
