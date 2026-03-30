// ============================================================
// GATES ROUTES — Cross-project stage control API
// ============================================================
// Provides endpoints for the Gates workspace:
//   /api/gates/pipeline    — all active projects with stage data
//   /api/gates/blocked     — projects where gate is blocked
//   /api/gates/ready       — projects ready for review/progression
//   /api/gates/exceptions  — all open exceptions across projects
//   /api/gates/client-updates — weekly update compliance
//   /api/gates/handovers   — O&M + Client handover queue
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Shared query builder ────────────────────────────────────

async function getProjectsWithStageData(filter?: {
  gateStatuses?: string[];
  stageCodes?: string[];
}) {
  let query = sql`
    SELECT
      pi.id AS project_id,
      pi.project_name,
      pi.client_name,
      pi.pm,
      pi.pd,
      pi.contract_value,
      pes.current_stage_code,
      pes.gate_status,
      pes.gate_readiness_pct,
      pes.waiting_on_department,
      pes.waiting_on_user_id,
      pes.next_required_action,
      pes.rag_status,
      pes.execution_phase,
      pes.archived_status,
      pes.construction_manager,
      COALESCE(
        EXTRACT(DAY FROM NOW() - psi.started_at)::int,
        0
      ) AS days_in_stage,
      COALESCE(exc.open_exception_count, 0)::int AS open_exception_count
    FROM project_info pi
    JOIN project_execution_state pes ON pes.project_id = pi.id
    LEFT JOIN project_stage_instances psi
      ON psi.project_id = pi.id
      AND psi.stage_code = pes.current_stage_code
    LEFT JOIN (
      SELECT project_id, count(*)::int AS open_exception_count
      FROM project_stage_exceptions
      WHERE status = 'REQUESTED'
      GROUP BY project_id
    ) exc ON exc.project_id = pi.id
    WHERE pes.is_active = true
      AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
  `;

  if (filter?.gateStatuses?.length) {
    const statuses = filter.gateStatuses.map((s) => `'${s}'`).join(",");
    query = sql`${query} AND pes.gate_status IN (${sql.raw(statuses)})`;
  }

  if (filter?.stageCodes?.length) {
    const codes = filter.stageCodes.map((s) => `'${s}'`).join(",");
    query = sql`${query} AND pes.current_stage_code IN (${sql.raw(codes)})`;
  }

  query = sql`${query} ORDER BY days_in_stage DESC`;

  const result = await db.execute(query);
  return ((result as any).rows ?? []).map((r: any) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    clientName: r.client_name,
    pm: r.pm,
    pd: r.pd,
    constructionManager: r.construction_manager,
    currentStageCode: r.current_stage_code,
    gateStatus: r.gate_status,
    gateReadinessPct: r.gate_readiness_pct ?? 0,
    waitingOnDepartment: r.waiting_on_department,
    waitingOnUserId: r.waiting_on_user_id,
    nextRequiredAction: r.next_required_action,
    daysInStage: r.days_in_stage ?? 0,
    openExceptionCount: r.open_exception_count ?? 0,
    ragStatus: r.rag_status,
    contractValue: r.contract_value,
    executionPhase: r.execution_phase,
    archivedStatus: r.archived_status ?? "ACTIVE",
  }));
}

export function registerGatesRoutes(app: Express) {

// ── Pipeline (all active projects) ──────────────────────────

app.get("/api/gates/pipeline", async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData();

    // Compute stage counts
    const stageCounts: Record<string, number> = {};
    for (const p of projects) {
      const code = p.currentStageCode || "UNKNOWN";
      stageCounts[code] = (stageCounts[code] || 0) + 1;
    }

    res.json({ projects, stageCounts });
  } catch (err: any) {
    console.error("Gates pipeline error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Blocked ─────────────────────────────────────────────────

app.get("/api/gates/blocked", async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData({
      gateStatuses: ["BLOCKED"],
    });
    res.json({ projects });
  } catch (err: any) {
    console.error("Gates blocked error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Ready ───────────────────────────────────────────────────

app.get("/api/gates/ready", async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData({
      gateStatuses: ["READY_FOR_REVIEW", "APPROVED"],
    });
    res.json({ projects });
  } catch (err: any) {
    console.error("Gates ready error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Exceptions ──────────────────────────────────────────────

app.get("/api/gates/exceptions", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        pse.id,
        pse.project_id,
        pi.project_name,
        pse.stage_code,
        pse.requirement_code,
        pse.reason_text,
        pse.risk_level,
        pse.status,
        pse.requested_by_user_id,
        pse.created_at,
        pse.mitigation_text,
        pse.closeout_due_date
      FROM project_stage_exceptions pse
      JOIN project_info pi ON pi.id = pse.project_id
      WHERE pse.status = 'REQUESTED'
      ORDER BY
        CASE pse.risk_level
          WHEN 'CRITICAL' THEN 0
          WHEN 'HIGH' THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 3
          ELSE 4
        END,
        pse.created_at ASC
    `);

    res.json({ exceptions: (result as any).rows ?? [] });
  } catch (err: any) {
    console.error("Gates exceptions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Client Updates ──────────────────────────────────────────

app.get("/api/gates/client-updates", async (_req, res) => {
  try {
    // Show projects in active execution stages (S04-S09) with their last weekly review status
    const result = await db.execute(sql`
      SELECT
        pi.id AS project_id,
        pi.project_name,
        pi.client_name,
        pi.pm,
        pes.current_stage_code,
        pes.gate_status,
        wr.last_review_date,
        wr.review_count
      FROM project_info pi
      JOIN project_execution_state pes ON pes.project_id = pi.id
      LEFT JOIN (
        SELECT
          project_id,
          MAX(created_at) AS last_review_date,
          COUNT(*)::int AS review_count
        FROM weekly_project_reviews
        GROUP BY project_id
      ) wr ON wr.project_id = pi.id
      WHERE pes.is_active = true
        AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
        AND pes.current_stage_code IN (
          'S04_PD_PM_HANDOVER', 'S05_FINANCIAL_REVIEW', 'S06_CONSTRUCTION',
          'S07_COMMISSIONING', 'S08_OM_HANDOVER', 'S09_CLIENT_HANDOVER'
        )
      ORDER BY wr.last_review_date ASC NULLS FIRST
    `);

    res.json({ projects: (result as any).rows ?? [] });
  } catch (err: any) {
    console.error("Gates client-updates error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Handovers ───────────────────────────────────────────────

app.get("/api/gates/handovers", async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData({
      stageCodes: ["S08_OM_HANDOVER", "S09_CLIENT_HANDOVER"],
    });
    res.json({ projects });
  } catch (err: any) {
    console.error("Gates handovers error:", err);
    res.status(500).json({ error: err.message });
  }
});

} // end registerGatesRoutes
