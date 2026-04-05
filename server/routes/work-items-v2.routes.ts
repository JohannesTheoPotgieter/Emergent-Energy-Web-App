/**
 * Work Items API — Wave 2
 *
 * Read/write endpoints for work packages and work items using promoted schema.
 * Reads from core.v_work_items compatibility view, writes to core.work_items_clean.
 * INSTEAD OF triggers handle dual-write to legacy work_items table.
 *
 * Guardrail 1: Locked API contract for new screens.
 * Guardrail 3: Work items are NOT for formal workflows (those use governed_process).
 * Guardrail 5: Write authority controlled via checkPermission middleware.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/projects/:projectInstanceId/work-packages
 *
 * Returns work packages for a project (top-level grouping containers).
 */
router.get("/api/projects/:projectInstanceId/work-packages", requireAuth, checkPermission("work_items", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    const result = await db.execute(sql`
      SELECT
        wp.id,
        wp.workstream,
        wp.title,
        wp.description,
        wp.sort_order,
        wp.created_at,
        (SELECT COUNT(*)::int FROM core.work_items_clean wic WHERE wic.work_package_id = wp.id) AS item_count,
        (SELECT ROUND(AVG(COALESCE(wic.percent_complete, 0))::numeric, 1) FROM core.work_items_clean wic WHERE wic.work_package_id = wp.id) AS avg_completion
      FROM core.work_packages wp
      WHERE wp.project_instance_id = ${projectInstanceId}
      ORDER BY wp.sort_order, wp.created_at
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[WorkItems] Failed to fetch work packages:", err);
    res.status(500).json({ error: "Failed to fetch work packages" });
  }
});

/**
 * GET /api/projects/:projectInstanceId/work-items
 *
 * Returns work items for a project with optional filtering.
 * Supports: ?workPackageId=, ?status=, ?workstream=, ?assignee=
 */
router.get("/api/projects/:projectInstanceId/work-items", requireAuth, checkPermission("work_items", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    const workPackageId = req.query.workPackageId ? parseInt(req.query.workPackageId as string) : undefined;
    const status = req.query.status as string | undefined;
    const workstream = req.query.workstream as string | undefined;

    let whereClause = sql`WHERE wic.project_instance_id = ${projectInstanceId}`;
    if (workPackageId) {
      whereClause = sql`${whereClause} AND wic.work_package_id = ${workPackageId}`;
    }
    if (status) {
      whereClause = sql`${whereClause} AND wic.status = ${status}`;
    }
    if (workstream) {
      whereClause = sql`${whereClause} AND wp.workstream = ${workstream}`;
    }

    const result = await db.execute(sql`
      SELECT
        wic.id,
        wic.legacy_work_item_id,
        wic.work_package_id,
        wp.workstream,
        wic.title,
        wic.description,
        wic.status,
        wic.priority,
        wic.start_date,
        wic.end_date,
        wic.percent_complete,
        wic.is_milestone,
        wic.parent_id,
        wic.sort_order,
        owner_p.name_canonical AS owner_name,
        wic.assigned_to_party_id,
        wic.created_at,
        wic.updated_at
      FROM core.work_items_clean wic
      LEFT JOIN core.work_packages wp ON wp.id = wic.work_package_id
      LEFT JOIN core.parties owner_p ON owner_p.id = wic.assigned_to_party_id
      ${whereClause}
      ORDER BY wic.sort_order, wic.created_at
      LIMIT 500
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[WorkItems] Failed to fetch work items:", err);
    res.status(500).json({ error: "Failed to fetch work items" });
  }
});

/**
 * POST /api/work-items
 *
 * Creates a new work item in the promoted schema.
 */
router.post("/api/work-items", requireAuth, checkPermission("work_items", "create"), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      projectInstanceId, workPackageId, title, description,
      status, priority, startDate, endDate, isMilestone, parentId, assignedToPartyId,
    } = req.body;

    if (!projectInstanceId || !title) {
      return res.status(400).json({ error: "projectInstanceId and title are required" });
    }

    const result = await db.execute(sql`
      INSERT INTO core.work_items_clean (
        project_instance_id, work_package_id, title, description,
        status, priority, start_date, end_date, is_milestone,
        parent_id, assigned_to_party_id, sort_order
      ) VALUES (
        ${projectInstanceId}, ${workPackageId || null}, ${title}, ${description || null},
        ${status || 'Not Started'}, ${priority || null}, ${startDate || null}, ${endDate || null}, ${isMilestone || false},
        ${parentId || null}, ${assignedToPartyId || null}, 0
      )
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[WorkItems] Failed to create:", err);
    res.status(500).json({ error: "Failed to create work item" });
  }
});

/**
 * PATCH /api/work-items/:id
 *
 * Updates a work item in the promoted schema.
 */
router.patch("/api/work-items/:id", requireAuth, checkPermission("work_items", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid work item ID" });

    const { title, description, status, priority, startDate, endDate, percentComplete, assignedToPartyId } = req.body;

    const result = await db.execute(sql`
      UPDATE core.work_items_clean SET
        title = COALESCE(${title ?? null}, title),
        description = CASE WHEN ${description !== undefined} THEN ${description ?? null} ELSE description END,
        status = CASE WHEN ${status !== undefined} THEN ${status ?? null} ELSE status END,
        priority = CASE WHEN ${priority !== undefined} THEN ${priority ?? null} ELSE priority END,
        start_date = CASE WHEN ${startDate !== undefined} THEN ${startDate ?? null}::date ELSE start_date END,
        end_date = CASE WHEN ${endDate !== undefined} THEN ${endDate ?? null}::date ELSE end_date END,
        percent_complete = CASE WHEN ${percentComplete !== undefined} THEN ${percentComplete ?? 0}::real ELSE percent_complete END,
        assigned_to_party_id = CASE WHEN ${assignedToPartyId !== undefined} THEN ${assignedToPartyId ?? null}::bigint ELSE assigned_to_party_id END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Work item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[WorkItems] Failed to update:", err);
    res.status(500).json({ error: "Failed to update work item" });
  }
});

export function registerWorkItemsV2Routes(app: import("express").Express) {
  app.use(router);
}

export default router;
