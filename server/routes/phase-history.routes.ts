/**
 * Phase History + Gate Compatibility API — Wave 6 Step 2
 *
 * Presents stage lifecycle data in spine-aligned format.
 * Reads from existing stage lifecycle tables (adopted as-is per Decision C6).
 *
 * These endpoints align the existing stage model with the control pack's
 * phase_definition/project_phase_history vocabulary.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/projects/:projectInstanceId/phase-history
 * Returns phase/stage history for a project in spine-aligned format.
 */
router.get("/api/projects/:projectInstanceId/phase-history", requireAuth, checkPermission("stage_lifecycle", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    // Get the legacy project ID for stage lifecycle queries
    const projectResult = await db.execute(sql`
      SELECT legacy_project_id FROM core.project_instances WHERE id = ${projectInstanceId} LIMIT 1
    `);
    const legacyProjectId = (projectResult.rows[0] as { legacy_project_id: number } | undefined)?.legacy_project_id;
    if (!legacyProjectId) return res.status(404).json({ error: "Project not found" });

    // Read from stage lifecycle tables (adopted as-is)
    const phases = await db.execute(sql`
      SELECT
        psi.id,
        sd.stage_code AS code,
        sd.stage_name AS name,
        sd.sort_order,
        psi.status,
        psi.entered_at,
        psi.completed_at,
        psi.is_current,
        (SELECT COUNT(*)::int FROM project_stage_requirements psr WHERE psr.stage_instance_id = psi.id) AS requirement_count,
        (SELECT COUNT(*)::int FROM project_stage_requirements psr WHERE psr.stage_instance_id = psi.id AND psr.status = 'COMPLETE') AS requirements_complete,
        (SELECT COUNT(*)::int FROM project_stage_decisions psd WHERE psd.stage_instance_id = psi.id) AS decision_count
      FROM project_stage_instances psi
      JOIN stage_definitions sd ON sd.id = psi.stage_definition_id
      WHERE psi.project_id = ${legacyProjectId}
      ORDER BY sd.sort_order
    `);

    res.json({ phases: phases.rows });
  } catch (err) {
    console.error("[PhaseHistory] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch phase history" });
  }
});

/**
 * GET /api/projects/:projectInstanceId/current-gate
 * Returns current gate status with requirements and evidence.
 */
router.get("/api/projects/:projectInstanceId/current-gate", requireAuth, checkPermission("stage_lifecycle", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    const projectResult = await db.execute(sql`
      SELECT legacy_project_id FROM core.project_instances WHERE id = ${projectInstanceId} LIMIT 1
    `);
    const legacyProjectId = (projectResult.rows[0] as { legacy_project_id: number } | undefined)?.legacy_project_id;
    if (!legacyProjectId) return res.status(404).json({ error: "Project not found" });

    // Get current stage instance
    const currentStage = await db.execute(sql`
      SELECT
        psi.id AS stage_instance_id,
        sd.stage_code,
        sd.stage_name,
        psi.status,
        psi.entered_at
      FROM project_stage_instances psi
      JOIN stage_definitions sd ON sd.id = psi.stage_definition_id
      WHERE psi.project_id = ${legacyProjectId} AND psi.is_current = true
      LIMIT 1
    `);

    if (currentStage.rows.length === 0) {
      return res.json({ gate: null });
    }

    const stageInstanceId = (currentStage.rows[0] as { stage_instance_id: number }).stage_instance_id;

    // Get requirements
    const requirements = await db.execute(sql`
      SELECT
        psr.id,
        psr.requirement_name,
        psr.department,
        psr.status,
        psr.completed_at,
        u.name AS completed_by_name
      FROM project_stage_requirements psr
      LEFT JOIN users u ON u.id = psr.completed_by_user_id
      WHERE psr.stage_instance_id = ${stageInstanceId}
      ORDER BY psr.sort_order
    `);

    // Get evidence
    const evidence = await db.execute(sql`
      SELECT
        pse.id,
        pse.evidence_type,
        pse.title,
        pse.status,
        pse.submitted_at,
        u.name AS submitted_by_name
      FROM project_stage_evidence pse
      LEFT JOIN users u ON u.id = pse.submitted_by_user_id
      WHERE pse.stage_instance_id = ${stageInstanceId}
      ORDER BY pse.submitted_at DESC
    `);

    // Get decisions
    const decisions = await db.execute(sql`
      SELECT
        psd.id,
        psd.decision_type,
        psd.outcome,
        psd.notes,
        psd.decided_at,
        u.name AS decided_by_name
      FROM project_stage_decisions psd
      LEFT JOIN users u ON u.id = psd.decided_by_user_id
      WHERE psd.stage_instance_id = ${stageInstanceId}
      ORDER BY psd.decided_at DESC
    `);

    res.json({
      gate: {
        ...currentStage.rows[0],
        requirements: requirements.rows,
        evidence: evidence.rows,
        decisions: decisions.rows,
      },
    });
  } catch (err) {
    console.error("[PhaseHistory] Failed to fetch current gate:", err);
    res.status(500).json({ error: "Failed to fetch current gate" });
  }
});

export function registerPhaseHistoryRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;
