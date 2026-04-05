/**
 * Deliverables API — Wave 4
 *
 * CRUD for deliverable definitions, instances, and resource linking.
 * Reads/writes to documentation.deliverable_definitions, documentation.documents (instances),
 * and documentation.external_resources + documentation.resource_links.
 *
 * Guardrail 1: Locked API contract.
 * Guardrail 5: Definitions are templates; instances are project-specific.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/deliverable-definitions
 * List all active deliverable definitions (templates).
 */
router.get("/api/deliverable-definitions", requireAuth, checkPermission("deliverables", "view"), async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM core.deliverable_definitions
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[Deliverables] Failed to list definitions:", err);
    res.status(500).json({ error: "Failed to list deliverable definitions" });
  }
});

/**
 * GET /api/projects/:projectInstanceId/deliverables
 * List deliverable instances for a project.
 */
router.get("/api/projects/:projectInstanceId/deliverables", requireAuth, checkPermission("deliverables", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    const result = await db.execute(sql`
      SELECT
        di.id,
        di.legacy_deliverable_id,
        di.deliverable_definition_id,
        dd.name AS definition_name,
        dd.code AS definition_code,
        di.title,
        di.status,
        di.current_version,
        di.completed_at,
        owner_p.name_canonical AS owner_name,
        reviewer_p.name_canonical AS reviewer_name,
        pd.name AS phase_name,
        di.created_at,
        di.updated_at,
        (SELECT COUNT(*)::int FROM core.resource_links rl WHERE rl.entity_type = 'deliverable_instance' AND rl.entity_id = di.id) AS resource_count
      FROM core.deliverable_instances di
      LEFT JOIN core.deliverable_definitions dd ON dd.id = di.deliverable_definition_id
      LEFT JOIN core.parties owner_p ON owner_p.id = di.owner_party_id
      LEFT JOIN core.parties reviewer_p ON reviewer_p.id = di.reviewer_party_id
      LEFT JOIN core.phase_definitions pd ON pd.id = di.phase_definition_id
      WHERE di.project_instance_id = ${projectInstanceId}
      ORDER BY di.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[Deliverables] Failed to list instances:", err);
    res.status(500).json({ error: "Failed to list deliverables" });
  }
});

/**
 * GET /api/deliverables/:id
 * Detail view with resources.
 */
router.get("/api/deliverables/:id", requireAuth, checkPermission("deliverables", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid deliverable ID" });

    const delivResult = await db.execute(sql`
      SELECT
        di.*,
        dd.name AS definition_name,
        dd.code AS definition_code,
        dd.description AS definition_description,
        owner_p.name_canonical AS owner_name,
        reviewer_p.name_canonical AS reviewer_name,
        pd.name AS phase_name
      FROM core.deliverable_instances di
      LEFT JOIN core.deliverable_definitions dd ON dd.id = di.deliverable_definition_id
      LEFT JOIN core.parties owner_p ON owner_p.id = di.owner_party_id
      LEFT JOIN core.parties reviewer_p ON reviewer_p.id = di.reviewer_party_id
      LEFT JOIN core.phase_definitions pd ON pd.id = di.phase_definition_id
      WHERE di.id = ${id}
    `);

    if (delivResult.rows.length === 0) return res.status(404).json({ error: "Deliverable not found" });

    const resourcesResult = await db.execute(sql`
      SELECT
        er.id AS resource_id,
        er.resource_type,
        er.file_name,
        er.web_url,
        er.mime_type,
        er.file_size,
        rl.link_purpose,
        rl.linked_at,
        uploader.name_canonical AS uploaded_by_name
      FROM core.resource_links rl
      JOIN core.external_resources er ON er.id = rl.external_resource_id
      LEFT JOIN core.parties uploader ON uploader.id = er.uploaded_by_party_id
      WHERE rl.entity_type = 'deliverable_instance' AND rl.entity_id = ${id}
      ORDER BY rl.linked_at DESC
    `);

    res.json({
      deliverable: delivResult.rows[0],
      resources: resourcesResult.rows,
    });
  } catch (err) {
    console.error("[Deliverables] Failed to fetch detail:", err);
    res.status(500).json({ error: "Failed to fetch deliverable" });
  }
});

/**
 * POST /api/deliverables
 * Create a new deliverable instance.
 */
router.post("/api/deliverables", requireAuth, checkPermission("deliverables", "create"), async (req: Request, res: Response) => {
  try {
    const { definitionId, projectInstanceId, title, ownerPartyId, reviewerPartyId, phaseDefinitionId } = req.body;
    if (!projectInstanceId || !title) {
      return res.status(400).json({ error: "projectInstanceId and title are required" });
    }

    const result = await db.execute(sql`
      INSERT INTO core.deliverable_instances (
        legacy_deliverable_id, legacy_deliverable_table,
        deliverable_definition_id, project_instance_id,
        phase_definition_id, owner_party_id, reviewer_party_id,
        title, status, current_version
      ) VALUES (
        0, 'api_created',
        ${definitionId || null}, ${projectInstanceId},
        ${phaseDefinitionId || null}, ${ownerPartyId || null}, ${reviewerPartyId || null},
        ${title}, 'pending', 1
      )
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[Deliverables] Failed to create:", err);
    res.status(500).json({ error: "Failed to create deliverable" });
  }
});

/**
 * PATCH /api/deliverables/:id
 * Update deliverable instance (status, reviewer, etc).
 */
router.patch("/api/deliverables/:id", requireAuth, checkPermission("deliverables", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid deliverable ID" });

    const { status, title, reviewerPartyId, currentVersion } = req.body;

    const result = await db.execute(sql`
      UPDATE core.deliverable_instances SET
        status = COALESCE(${status || null}, status),
        title = COALESCE(${title || null}, title),
        reviewer_party_id = CASE WHEN ${reviewerPartyId !== undefined} THEN ${reviewerPartyId ?? null}::bigint ELSE reviewer_party_id END,
        current_version = CASE WHEN ${currentVersion !== undefined} THEN ${currentVersion ?? 1}::int ELSE current_version END,
        completed_at = CASE WHEN ${status} IN ('approved', 'complete') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Deliverable not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Deliverables] Failed to update:", err);
    res.status(500).json({ error: "Failed to update deliverable" });
  }
});

export function registerDeliverablesV2Routes(app: import("express").Express) {
  app.use(router);
}

export default router;
