// ============================================================
// LIFECYCLE APPROVALS ROUTES — Gate, exception & handover
// approval queue (stage lifecycle domain).
//
// NOT the same as server/approvals-routes.ts which handles
// general-purpose CRUD approvals on the `approvals` table.
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { jwtAuth, requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";

// Helper: execute a query, returning empty array if a referenced table/column doesn't exist
async function safeQuery(query: ReturnType<typeof sql>) {
  try {
    const result = await db.execute(query);
    return (result as any).rows ?? [];
  } catch (err: any) {
    // 42P01 = undefined_table, 42703 = undefined_column
    if (err.code === "42P01" || err.code === "42703") return [];
    throw err;
  }
}

export function registerLifecycleApprovalsRoutes(app: Express) {

// ── Unified approvals queue ────────────────────────────────

app.get("/api/approvals", jwtAuth, requireAuth, requirePermission("stage_gate", "view"), async (req, res) => {
  try {
    const userId = (req as any).user?.id || 0;
    const typeFilter = req.query.type as string | undefined;

    // Gather gate approvals (stages READY_FOR_REVIEW where user is approver)
    const gateRows = await safeQuery(sql`
      SELECT
        'gate' AS approval_type,
        psi.id AS item_id,
        pi.project_name,
        psi.stage_code,
        u.name AS requested_by,
        psi.updated_at AS date_requested,
        'normal' AS priority,
        COALESCE(EXTRACT(DAY FROM NOW() - psi.updated_at)::int, 0) AS age_days,
        CONCAT('Gate approval for ', psi.stage_code) AS summary
      FROM project_stage_instances psi
      JOIN project_info pi ON pi.id = psi.project_id
      LEFT JOIN users u ON u.id = psi.stage_owner_user_id
      WHERE psi.stage_status = 'READY_FOR_REVIEW'
        AND (psi.approver_user_id = ${userId} OR ${userId} = 0)
    `);

    // Gather exception approvals
    const exceptionRows = await safeQuery(sql`
      SELECT
        'exception' AS approval_type,
        pse.id AS item_id,
        pi.project_name,
        pse.stage_code,
        u.name AS requested_by,
        pse.created_at AS date_requested,
        pse.risk_level AS priority,
        COALESCE(EXTRACT(DAY FROM NOW() - pse.created_at)::int, 0) AS age_days,
        CONCAT('Exception: ', LEFT(pse.reason_text, 80)) AS summary
      FROM project_stage_exceptions pse
      JOIN project_info pi ON pi.id = pse.project_id
      LEFT JOIN users u ON u.id = pse.owner_user_id
      WHERE pse.status = 'REQUESTED'
        AND (pse.approver_user_id = ${userId} OR ${userId} = 0)
    `);

    // Gather handover acceptances (packs awaiting review)
    const handoverRows = await safeQuery(sql`
      SELECT
        'handover' AS approval_type,
        hp.id AS item_id,
        pi.project_name,
        NULL AS stage_code,
        pi.pm AS requested_by,
        hp.updated_at AS date_requested,
        'normal' AS priority,
        COALESCE(EXTRACT(DAY FROM NOW() - hp.updated_at)::int, 0) AS age_days,
        CONCAT(hp.pack_type, ' handover pack review') AS summary
      FROM handover_packs hp
      JOIN project_info pi ON pi.id = hp.project_id
      JOIN project_execution_state pes ON pes.project_id = pi.id
      WHERE hp.checklist_status = 'pending_review'
        AND pes.is_active = true
    `);

    let allApprovals = [
      ...gateRows,
      ...exceptionRows,
      ...handoverRows,
    ];

    // Filter by type if specified
    if (typeFilter) {
      allApprovals = allApprovals.filter((a: any) => a.approval_type === typeFilter);
    }

    // Sort by age descending (oldest first)
    allApprovals.sort((a: any, b: any) => (b.age_days || 0) - (a.age_days || 0));

    res.json({ approvals: allApprovals });
  } catch (err: any) {
    console.error("Approvals error:", err);
    throw err;
  }
});

// ── Approval action ────────────────────────────────────────

app.patch("/api/approvals/:type/:id/action", jwtAuth, requireAuth, requirePermission("stage_gate", "edit"), async (req, res) => {
  try {
    const { type, id } = req.params;
    const { action, comment, delegateToUserId } = req.body;
    const itemId = Number(id);
    const actor = getEffectiveUser(req);

    if (action === "delegate" && delegateToUserId) {
      if (type === "gate") {
        await db.execute(sql`UPDATE project_stage_instances SET approver_user_id = ${delegateToUserId} WHERE id = ${itemId}`);
      } else if (type === "exception") {
        await db.execute(sql`UPDATE project_stage_exceptions SET approver_user_id = ${delegateToUserId} WHERE id = ${itemId}`);
      }
      logAuditFromReq(req, {
        entityType: `lifecycle_${type}`,
        entityId: String(itemId),
        action: "delegated",
        changesJson: { type, delegateToUserId },
      });
      return res.json({ success: true, action: "delegated" });
    }

    if (type === "gate") {
      const newStatus = action === "approve" ? "APPROVED" : action === "reject" ? "BLOCKED" : "READY_FOR_REVIEW";
      await db.execute(sql`
        UPDATE project_stage_instances
        SET stage_status = ${newStatus}, updated_at = NOW()
        WHERE id = ${itemId}
      `);
    } else if (type === "exception") {
      const newStatus = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "REQUESTED";
      await db.execute(sql`
        UPDATE project_stage_exceptions
        SET status = ${newStatus}, updated_at = NOW()
        WHERE id = ${itemId}
      `);
    } else if (type === "handover") {
      const newStatus = action === "approve" ? "complete" : action === "reject" ? "rejected" : "pending_review";
      await db.execute(sql`
        UPDATE handover_packs
        SET checklist_status = ${newStatus}, updated_at = NOW()
        WHERE id = ${itemId}
      `);
    }

    logAuditFromReq(req, {
      entityType: `lifecycle_${type}`,
      entityId: String(itemId),
      action: `lifecycle_approval_${action}`,
      changesJson: { type, action, comment: comment || null },
    });

    res.json({ success: true, action });
  } catch (err: any) {
    console.error("Approval action error:", err);
    throw err;
  }
});

} // end registerLifecycleApprovalsRoutes
