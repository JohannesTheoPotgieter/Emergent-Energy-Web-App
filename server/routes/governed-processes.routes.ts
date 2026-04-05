/**
 * Governed Processes API — Wave 3
 *
 * Single engine for all formal controlled workflows:
 * financial_review, pd_to_pm_handover, phase_gate_review,
 * gate_exception, change_request, payment_batch.
 *
 * Reads/writes to core.governed_processes and core.governed_process_checklist_items.
 *
 * Guardrail 3: ONLY for formal controlled workflows — NOT for normal work execution.
 * Guardrail 1: Locked API contract for new screens.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

// ─── Process Templates ──────────────────────────────────────────
// Default checklist items per process type (seed data)

const PROCESS_TEMPLATES: Record<string, Array<{ item_code: string; title: string; category: string; blocks_gate: boolean; sort_order: number }>> = {
  pd_to_pm_handover: [
    { item_code: "hdvr_commercial", title: "Commercial terms confirmed", category: "commercial", blocks_gate: true, sort_order: 1 },
    { item_code: "hdvr_contract", title: "Contract documentation complete", category: "commercial", blocks_gate: true, sort_order: 2 },
    { item_code: "hdvr_site_assessment", title: "Site assessment report uploaded", category: "technical", blocks_gate: true, sort_order: 3 },
    { item_code: "hdvr_design_brief", title: "Design brief completed", category: "technical", blocks_gate: false, sort_order: 4 },
    { item_code: "hdvr_client_intro", title: "Client introduction to PM done", category: "relationship", blocks_gate: false, sort_order: 5 },
    { item_code: "hdvr_risk_register", title: "Risk register handover", category: "governance", blocks_gate: false, sort_order: 6 },
    { item_code: "hdvr_budget_baseline", title: "Budget baseline approved", category: "financial", blocks_gate: true, sort_order: 7 },
  ],
  financial_review: [
    { item_code: "finrev_budget_check", title: "Budget vs actuals reviewed", category: "review", blocks_gate: true, sort_order: 1 },
    { item_code: "finrev_variance", title: "Variances documented and explained", category: "review", blocks_gate: true, sort_order: 2 },
    { item_code: "finrev_cashflow", title: "Cashflow forecast updated", category: "forecast", blocks_gate: false, sort_order: 3 },
    { item_code: "finrev_risk", title: "Financial risks identified", category: "risk", blocks_gate: false, sort_order: 4 },
    { item_code: "finrev_approval", title: "CFO/Finance manager sign-off", category: "approval", blocks_gate: true, sort_order: 5 },
  ],
  phase_gate_review: [
    { item_code: "gate_deliverables", title: "All phase deliverables complete", category: "deliverables", blocks_gate: true, sort_order: 1 },
    { item_code: "gate_quality", title: "Quality checks passed", category: "quality", blocks_gate: true, sort_order: 2 },
    { item_code: "gate_finance", title: "Financial position reviewed", category: "financial", blocks_gate: false, sort_order: 3 },
    { item_code: "gate_risk", title: "Risk register updated for next phase", category: "risk", blocks_gate: false, sort_order: 4 },
    { item_code: "gate_approval", title: "Gate approval granted", category: "approval", blocks_gate: true, sort_order: 5 },
  ],
  change_request: [
    { item_code: "cr_description", title: "Change description documented", category: "documentation", blocks_gate: true, sort_order: 1 },
    { item_code: "cr_impact", title: "Impact assessment (cost, schedule, scope)", category: "assessment", blocks_gate: true, sort_order: 2 },
    { item_code: "cr_approval", title: "Change authority approval", category: "approval", blocks_gate: true, sort_order: 3 },
    { item_code: "cr_implementation", title: "Implementation plan documented", category: "implementation", blocks_gate: false, sort_order: 4 },
  ],
  payment_batch: [
    { item_code: "pb_invoices", title: "All invoices verified", category: "verification", blocks_gate: true, sort_order: 1 },
    { item_code: "pb_amounts", title: "Payment amounts confirmed", category: "verification", blocks_gate: true, sort_order: 2 },
    { item_code: "pb_bank_details", title: "Bank details verified", category: "verification", blocks_gate: true, sort_order: 3 },
    { item_code: "pb_approval", title: "Payment batch approved", category: "approval", blocks_gate: true, sort_order: 4 },
  ],
  gate_exception: [
    { item_code: "exc_justification", title: "Exception justification documented", category: "documentation", blocks_gate: true, sort_order: 1 },
    { item_code: "exc_risk", title: "Risk of proceeding without gate documented", category: "risk", blocks_gate: true, sort_order: 2 },
    { item_code: "exc_conditions", title: "Conditions for exception documented", category: "conditions", blocks_gate: false, sort_order: 3 },
    { item_code: "exc_approval", title: "Exception approved by authority", category: "approval", blocks_gate: true, sort_order: 4 },
  ],
};

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["in_progress", "cancelled"],
  in_progress: ["awaiting_review", "cancelled"],
  awaiting_review: ["approved", "rejected", "in_progress"],
  rejected: ["in_progress", "cancelled"],
  approved: ["completed"],
  completed: [],
  cancelled: [],
};

// ─── List ────────────────────────────────────────────────────────

/**
 * GET /api/governed-processes
 *
 * List governed processes with filtering.
 */
router.get("/api/governed-processes", requireAuth, checkPermission("projects", "view"), async (req: Request, res: Response) => {
  try {
    const projectInstanceId = req.query.projectInstanceId ? parseInt(req.query.projectInstanceId as string) : undefined;
    const processType = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let whereClause = sql`WHERE 1=1`;
    if (projectInstanceId) whereClause = sql`${whereClause} AND gp.project_instance_id = ${projectInstanceId}`;
    if (processType) whereClause = sql`${whereClause} AND gp.process_type = ${processType}`;
    if (status) whereClause = sql`${whereClause} AND gp.status = ${status}`;

    const result = await db.execute(sql`
      SELECT
        gp.id,
        gp.process_type,
        gp.project_instance_id,
        gp.status,
        gp.title,
        gp.started_at,
        gp.completed_at,
        gp.process_data,
        owner_p.name_canonical AS owner_name,
        reviewer_p.name_canonical AS reviewer_name,
        pd.name AS phase_name,
        (SELECT COUNT(*)::int FROM core.governed_process_checklist_items ci WHERE ci.governed_process_id = gp.id) AS checklist_total,
        (SELECT COUNT(*)::int FROM core.governed_process_checklist_items ci WHERE ci.governed_process_id = gp.id AND ci.status = 'complete') AS checklist_done
      FROM core.governed_processes gp
      LEFT JOIN core.parties owner_p ON owner_p.id = gp.owner_party_id
      LEFT JOIN core.parties reviewer_p ON reviewer_p.id = gp.reviewer_party_id
      LEFT JOIN core.phase_definitions pd ON pd.id = gp.phase_definition_id
      ${whereClause}
      ORDER BY gp.updated_at DESC
      LIMIT ${limit}
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[GovernedProcess] Failed to list:", err);
    res.status(500).json({ error: "Failed to list governed processes" });
  }
});

// ─── Detail ──────────────────────────────────────────────────────

/**
 * GET /api/governed-processes/:id
 *
 * Returns process detail with checklist items.
 */
router.get("/api/governed-processes/:id", requireAuth, checkPermission("projects", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid process ID" });

    const processResult = await db.execute(sql`
      SELECT
        gp.*,
        owner_p.name_canonical AS owner_name,
        reviewer_p.name_canonical AS reviewer_name,
        pd.name AS phase_name,
        pd.code AS phase_code
      FROM core.governed_processes gp
      LEFT JOIN core.parties owner_p ON owner_p.id = gp.owner_party_id
      LEFT JOIN core.parties reviewer_p ON reviewer_p.id = gp.reviewer_party_id
      LEFT JOIN core.phase_definitions pd ON pd.id = gp.phase_definition_id
      WHERE gp.id = ${id}
    `);

    if (processResult.rows.length === 0) {
      return res.status(404).json({ error: "Process not found" });
    }

    const checklistResult = await db.execute(sql`
      SELECT
        ci.*,
        owner_p.name_canonical AS owner_name
      FROM core.governed_process_checklist_items ci
      LEFT JOIN core.parties owner_p ON owner_p.id = ci.owner_party_id
      WHERE ci.governed_process_id = ${id}
      ORDER BY ci.sort_order, ci.created_at
    `);

    res.json({
      process: processResult.rows[0],
      checklistItems: checklistResult.rows,
    });
  } catch (err) {
    console.error("[GovernedProcess] Failed to fetch detail:", err);
    res.status(500).json({ error: "Failed to fetch process detail" });
  }
});

// ─── Create ──────────────────────────────────────────────────────

/**
 * POST /api/governed-processes
 *
 * Creates a new governed process with auto-generated checklist from template.
 */
router.post("/api/governed-processes", requireAuth, checkPermission("projects", "edit"), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { processType, projectInstanceId, title, processData, reviewerPartyId } = req.body;

    if (!processType || !projectInstanceId) {
      return res.status(400).json({ error: "processType and projectInstanceId are required" });
    }

    if (!PROCESS_TEMPLATES[processType]) {
      return res.status(400).json({ error: `Invalid process type: ${processType}. Valid types: ${Object.keys(PROCESS_TEMPLATES).join(", ")}` });
    }

    // Look up the owner party for the current user
    const userPartyResult = await db.execute(sql`
      SELECT id FROM core.parties WHERE legacy_user_id = ${user.id} LIMIT 1
    `);
    const ownerPartyId = (userPartyResult.rows[0] as { id: number } | undefined)?.id ?? null;

    // Create process
    const processResult = await db.execute(sql`
      INSERT INTO core.governed_processes (
        legacy_entity_id, legacy_entity_table,
        project_instance_id, process_type, status,
        owner_party_id, reviewer_party_id,
        title, started_at, process_data
      ) VALUES (
        0, ${processType},
        ${projectInstanceId}, ${processType}, 'draft',
        ${ownerPartyId}, ${reviewerPartyId || null},
        ${title || `${processType} — New Process`}, NOW(), ${JSON.stringify(processData || {})}::jsonb
      )
      RETURNING *
    `);

    const processId = (processResult.rows[0] as { id: number }).id;

    // Auto-create checklist items from template
    const template = PROCESS_TEMPLATES[processType];
    for (const item of template) {
      await db.execute(sql`
        INSERT INTO core.governed_process_checklist_items (
          governed_process_id, item_code, title, category,
          status, blocks_gate, sort_order
        ) VALUES (
          ${processId}, ${item.item_code}, ${item.title}, ${item.category},
          'pending', ${item.blocks_gate}, ${item.sort_order}
        )
      `);
    }

    res.status(201).json(processResult.rows[0]);
  } catch (err) {
    console.error("[GovernedProcess] Failed to create:", err);
    res.status(500).json({ error: "Failed to create governed process" });
  }
});

// ─── Update Status ───────────────────────────────────────────────

/**
 * PATCH /api/governed-processes/:id
 *
 * Updates process status with transition enforcement.
 */
router.patch("/api/governed-processes/:id", requireAuth, checkPermission("projects", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid process ID" });

    const { status, title, reviewerPartyId, processData } = req.body;

    // If status change, validate transition
    if (status) {
      const currentResult = await db.execute(sql`
        SELECT status FROM core.governed_processes WHERE id = ${id}
      `);
      if (currentResult.rows.length === 0) return res.status(404).json({ error: "Process not found" });

      const currentStatus = (currentResult.rows[0] as { status: string }).status;
      const allowed = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Invalid transition: ${currentStatus} → ${status}. Allowed: ${allowed.join(", ")}`,
        });
      }

      // If moving to approved/completed, check that blocking checklist items are done
      if (status === "approved" || status === "completed") {
        const blockingResult = await db.execute(sql`
          SELECT COUNT(*)::int AS blocking_count
          FROM core.governed_process_checklist_items
          WHERE governed_process_id = ${id}
            AND blocks_gate = true
            AND status != 'complete'
            AND status != 'not_applicable'
        `);
        const blockingCount = (blockingResult.rows[0] as { blocking_count: number }).blocking_count;
        if (blockingCount > 0) {
          return res.status(400).json({
            error: `Cannot ${status}: ${blockingCount} blocking checklist item(s) incomplete`,
          });
        }
      }
    }

    const result = await db.execute(sql`
      UPDATE core.governed_processes SET
        status = COALESCE(${status || null}, status),
        title = COALESCE(${title || null}, title),
        reviewer_party_id = CASE WHEN ${reviewerPartyId !== undefined} THEN ${reviewerPartyId ?? null}::bigint ELSE reviewer_party_id END,
        process_data = CASE WHEN ${processData !== undefined} THEN ${JSON.stringify(processData || {})}::jsonb ELSE process_data END,
        completed_at = CASE WHEN ${status} IN ('approved', 'completed', 'cancelled') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Process not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[GovernedProcess] Failed to update:", err);
    res.status(500).json({ error: "Failed to update governed process" });
  }
});

// ─── Update Checklist Item ───────────────────────────────────────

/**
 * PATCH /api/governed-processes/:id/checklist/:itemId
 *
 * Updates a checklist item status.
 */
router.patch("/api/governed-processes/:id/checklist/:itemId", requireAuth, checkPermission("projects", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rawItemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
    const processId = parseInt(rawId);
    const itemId = parseInt(rawItemId);
    if (isNaN(processId) || isNaN(itemId)) return res.status(400).json({ error: "Invalid IDs" });

    const { status, evidenceUrl, notes } = req.body;

    const result = await db.execute(sql`
      UPDATE core.governed_process_checklist_items SET
        status = COALESCE(${status || null}, status),
        evidence_url = CASE WHEN ${evidenceUrl !== undefined} THEN ${evidenceUrl ?? null} ELSE evidence_url END,
        notes = CASE WHEN ${notes !== undefined} THEN ${notes ?? null} ELSE notes END,
        completed_at = CASE WHEN ${status} = 'complete' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
      WHERE id = ${itemId} AND governed_process_id = ${processId}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Checklist item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[GovernedProcess] Failed to update checklist item:", err);
    res.status(500).json({ error: "Failed to update checklist item" });
  }
});

// ─── Process Types ───────────────────────────────────────────────

/**
 * GET /api/governed-processes/types
 *
 * Returns available process types with their template info.
 */
router.get("/api/governed-processes/types", requireAuth, async (_req: Request, res: Response) => {
  try {
    const types = Object.entries(PROCESS_TEMPLATES).map(([type, items]) => ({
      type,
      label: type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      checklistItemCount: items.length,
      blockingItemCount: items.filter((i) => i.blocks_gate).length,
    }));
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch process types" });
  }
});

export function registerGovernedProcessRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;
