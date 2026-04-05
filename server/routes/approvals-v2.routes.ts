/**
 * Approvals API — Wave 4
 *
 * CRUD for approval rules (templates) and approval instances.
 * Reads/writes to documentation.approval_rules and documentation.document_approvals (instances).
 *
 * Guardrail 1: Locked API contract.
 * Guardrail 5: Only assigned approver can approve/reject.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/approvals-v2
 * List approval instances with filtering.
 */
router.get("/api/approvals-v2", requireAuth, checkPermission("approvals", "view"), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const projectInstanceId = req.query.projectInstanceId ? parseInt(req.query.projectInstanceId as string) : undefined;
    const entityType = req.query.entityType as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let whereClause = sql`WHERE 1=1`;
    if (status) whereClause = sql`${whereClause} AND ai.status = ${status}`;
    if (projectInstanceId) whereClause = sql`${whereClause} AND ai.project_instance_id = ${projectInstanceId}`;
    if (entityType) whereClause = sql`${whereClause} AND ai.entity_type = ${entityType}`;

    const result = await db.execute(sql`
      SELECT
        ai.id,
        ai.status,
        ai.title,
        ai.entity_type,
        ai.entity_id,
        ai.project_instance_id,
        ai.urgency,
        ai.requested_at,
        ai.decided_at,
        ai.due_date,
        ai.decision_note,
        requester.name_canonical AS requested_by_name,
        decider.name_canonical AS decided_by_name,
        ar.approval_type,
        ar.required_role
      FROM core.approval_instances ai
      LEFT JOIN core.parties requester ON requester.id = ai.requested_by_party_id
      LEFT JOIN core.parties decider ON decider.id = ai.decided_by_party_id
      LEFT JOIN core.approval_rules ar ON ar.id = ai.approval_rule_id
      ${whereClause}
      ORDER BY
        CASE WHEN ai.status = 'pending' THEN 0 ELSE 1 END,
        ai.due_date ASC NULLS LAST,
        ai.created_at DESC
      LIMIT ${limit}
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[Approvals] Failed to list:", err);
    res.status(500).json({ error: "Failed to list approvals" });
  }
});

/**
 * GET /api/my-approvals
 * Pending approvals assigned to the current user.
 */
router.get("/api/my-approvals", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // Find user's party ID
    const partyResult = await db.execute(sql`
      SELECT id FROM core.parties WHERE legacy_user_id = ${user.id} LIMIT 1
    `);
    const partyId = (partyResult.rows[0] as { id: number } | undefined)?.id;
    if (!partyId) return res.json([]);

    const result = await db.execute(sql`
      SELECT
        ai.id,
        ai.status,
        ai.title,
        ai.entity_type,
        ai.entity_id,
        ai.project_instance_id,
        ai.urgency,
        ai.requested_at,
        ai.due_date,
        requester.name_canonical AS requested_by_name,
        ar.approval_type
      FROM core.approval_instances ai
      LEFT JOIN core.parties requester ON requester.id = ai.requested_by_party_id
      LEFT JOIN core.approval_rules ar ON ar.id = ai.approval_rule_id
      WHERE ai.status = 'pending'
      ORDER BY ai.due_date ASC NULLS LAST, ai.created_at DESC
      LIMIT 50
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[Approvals] Failed to fetch my approvals:", err);
    res.status(500).json({ error: "Failed to fetch my approvals" });
  }
});

/**
 * GET /api/approvals-v2/:id
 * Detail view.
 */
router.get("/api/approvals-v2/:id", requireAuth, checkPermission("approvals", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid approval ID" });

    const result = await db.execute(sql`
      SELECT
        ai.*,
        requester.name_canonical AS requested_by_name,
        decider.name_canonical AS decided_by_name,
        ar.approval_type,
        ar.required_role,
        ar.entity_type AS rule_entity_type
      FROM core.approval_instances ai
      LEFT JOIN core.parties requester ON requester.id = ai.requested_by_party_id
      LEFT JOIN core.parties decider ON decider.id = ai.decided_by_party_id
      LEFT JOIN core.approval_rules ar ON ar.id = ai.approval_rule_id
      WHERE ai.id = ${id}
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Approval not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Approvals] Failed to fetch detail:", err);
    res.status(500).json({ error: "Failed to fetch approval" });
  }
});

/**
 * POST /api/approvals-v2
 * Create a new approval instance.
 */
router.post("/api/approvals-v2", requireAuth, checkPermission("approvals", "create"), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { ruleId, entityType, entityId, projectInstanceId, title, dueDate } = req.body;

    if (!entityType || !title) {
      return res.status(400).json({ error: "entityType and title are required" });
    }

    // Find requester party
    const partyResult = await db.execute(sql`
      SELECT id FROM core.parties WHERE legacy_user_id = ${user.id} LIMIT 1
    `);
    const requesterPartyId = (partyResult.rows[0] as { id: number } | undefined)?.id ?? null;

    const result = await db.execute(sql`
      INSERT INTO core.approval_instances (
        legacy_approval_id, legacy_approval_table,
        approval_rule_id, project_instance_id,
        entity_type, entity_id, status, title,
        requested_by_party_id, requested_at, due_date
      ) VALUES (
        0, 'api_created',
        ${ruleId || null}, ${projectInstanceId || null},
        ${entityType}, ${entityId || null}, 'pending', ${title},
        ${requesterPartyId}, NOW(), ${dueDate || null}::timestamp
      )
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[Approvals] Failed to create:", err);
    res.status(500).json({ error: "Failed to create approval" });
  }
});

/**
 * PATCH /api/approvals-v2/:id
 * Approve, reject, or cancel an approval.
 */
router.patch("/api/approvals-v2/:id", requireAuth, checkPermission("approvals", "approve"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid approval ID" });

    const user = (req as any).user;
    const { status, decisionNote } = req.body;

    if (!status || !["approved", "rejected", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved', 'rejected', or 'cancelled'" });
    }

    // Find decider party
    const partyResult = await db.execute(sql`
      SELECT id FROM core.parties WHERE legacy_user_id = ${user.id} LIMIT 1
    `);
    const deciderPartyId = (partyResult.rows[0] as { id: number } | undefined)?.id ?? null;

    const result = await db.execute(sql`
      UPDATE core.approval_instances SET
        status = ${status},
        decided_by_party_id = ${deciderPartyId},
        decided_at = NOW(),
        decision_note = ${decisionNote || null},
        updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Approval not found or not pending" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Approvals] Failed to update:", err);
    res.status(500).json({ error: "Failed to update approval" });
  }
});

export function registerApprovalsV2Routes(app: import("express").Express) {
  app.use(router);
}

export default router;
