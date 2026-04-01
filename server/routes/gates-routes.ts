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
import { jwtAuth, requireAuth } from "../auth-context";

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
      pes.construction_manager_user_id,
      COALESCE(
        EXTRACT(DAY FROM NOW() - psi.started_at)::int,
        0
      ) AS days_in_stage,
      COALESCE(exc.open_exception_count, 0)::int AS open_exception_count
    FROM project_info pi
    LEFT JOIN project_execution_state pes ON pes.project_id = pi.id
    LEFT JOIN project_stage_instances psi
      ON psi.project_id = pi.id
      AND psi.stage_code = pes.current_stage_code
    LEFT JOIN (
      SELECT project_id, count(*)::int AS open_exception_count
      FROM project_stage_exceptions
      WHERE status = 'REQUESTED'
      GROUP BY project_id
    ) exc ON exc.project_id = pi.id
    WHERE COALESCE(pes.is_active, true) = true
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
    constructionManager: r.construction_manager_user_id,
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

app.get("/api/gates/pipeline", jwtAuth, requireAuth, async (_req, res) => {
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
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ projects: [], stageCounts: {} });
    }
    console.error("Gates pipeline error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Blocked ─────────────────────────────────────────────────

app.get("/api/gates/blocked", jwtAuth, requireAuth, async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData({
      gateStatuses: ["BLOCKED"],
    });
    res.json({ projects });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ projects: [] });
    }
    console.error("Gates blocked error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Ready ───────────────────────────────────────────────────

app.get("/api/gates/ready", jwtAuth, requireAuth, async (_req, res) => {
  try {
    const projects = await getProjectsWithStageData({
      gateStatuses: ["READY_FOR_REVIEW", "APPROVED"],
    });
    res.json({ projects });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ projects: [] });
    }
    console.error("Gates ready error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Exceptions (enhanced for Prompt 6) ─────────────────────

app.get("/api/gates/exceptions", jwtAuth, requireAuth, async (req, res) => {
  try {
    const view = (req.query.view as string) || "all";
    const userId = (req as any).user?.id;

    let statusFilter = sql`1=1`;
    if (view === "pending_my_approval") {
      statusFilter = sql`pse.status = 'REQUESTED' AND pse.approver_user_id = ${userId || 0}`;
    } else if (view === "overdue") {
      statusFilter = sql`pse.status = 'REQUESTED' AND pse.created_at < NOW() - INTERVAL '3 days'`;
    } else if (view === "all") {
      statusFilter = sql`pse.status IN ('REQUESTED', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'RE_OPENED')`;
    }

    const result = await db.execute(sql`
      SELECT
        pse.id,
        pse.project_id,
        pi.project_name,
        pse.stage_code,
        pse.requirement_code,
        psr.item_name AS blocked_item_name,
        pse.reason_text,
        pse.risk_level,
        pse.mitigation_text,
        pse.owner_user_id,
        owner_u.name AS owner_name,
        pse.approver_user_id,
        approver_u.name AS approver_name,
        pse.status,
        pse.conditions_text,
        pse.closeout_due_date,
        COALESCE(EXTRACT(DAY FROM NOW() - pse.created_at)::int, 0) AS age_days,
        pse.downstream_blocking_stage,
        pse.created_at,
        pse.approved_at,
        pse.closed_at,
        pse.updated_at
      FROM project_stage_exceptions pse
      JOIN project_info pi ON pi.id = pse.project_id
      LEFT JOIN project_stage_requirements psr
        ON psr.project_id = pse.project_id
        AND psr.stage_code = pse.stage_code
        AND psr.item_code = pse.requirement_code
      LEFT JOIN users owner_u ON owner_u.id = pse.owner_user_id
      LEFT JOIN users approver_u ON approver_u.id = pse.approver_user_id
      WHERE ${statusFilter}
      ORDER BY
        CASE pse.risk_level
          WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4
        END,
        pse.created_at ASC
    `);

    res.json({ exceptions: (result as any).rows ?? [] });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ exceptions: [] });
    }
    console.error("Gates exceptions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Exception counts by view ───────────────────────────────

app.get("/api/gates/exceptions/counts", jwtAuth, requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id || 0;
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('REQUESTED','APPROVED','APPROVED_WITH_CONDITIONS','RE_OPENED')) AS all_count,
        COUNT(*) FILTER (WHERE status = 'REQUESTED' AND approver_user_id = ${userId}) AS pending_my_approval,
        COUNT(*) FILTER (WHERE status = 'REQUESTED' AND created_at < NOW() - INTERVAL '3 days') AS overdue_count
      FROM project_stage_exceptions
    `);
    const row = ((result as any).rows ?? [])[0] || {};
    res.json({
      all: Number(row.all_count || 0),
      pendingMyApproval: Number(row.pending_my_approval || 0),
      overdue: Number(row.overdue_count || 0),
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ all: 0, pendingMyApproval: 0, overdue: 0 });
    }
    console.error("Gates exceptions counts error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Exception actions ──────────────────────────────────────

app.patch("/api/gates/exceptions/:id/action", jwtAuth, requireAuth, async (req, res) => {
  try {
    const exceptionId = Number(req.params.id);
    const { action, conditionsText, comment } = req.body;
    const userId = (req as any).user?.id;

    const validActions = ["approve", "approve_with_conditions", "reject", "return", "close", "reopen", "escalate"];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action: ${action}` });
    }

    let newStatus: string;
    let extraFields = sql``;
    switch (action) {
      case "approve":
        newStatus = "APPROVED";
        extraFields = sql`, approved_at = NOW()`;
        break;
      case "approve_with_conditions":
        newStatus = "APPROVED_WITH_CONDITIONS";
        extraFields = sql`, approved_at = NOW(), conditions_text = ${conditionsText || ""}`;
        break;
      case "reject":
        newStatus = "REJECTED";
        break;
      case "return":
        newStatus = "REQUESTED";
        break;
      case "close":
        newStatus = "CLOSED";
        extraFields = sql`, closed_at = NOW()`;
        break;
      case "reopen":
        newStatus = "RE_OPENED";
        break;
      case "escalate":
        newStatus = "REQUESTED"; // stays requested but we could log escalation
        break;
      default:
        newStatus = "REQUESTED";
    }

    await db.execute(sql`
      UPDATE project_stage_exceptions
      SET status = ${newStatus}, updated_at = NOW() ${extraFields}
      WHERE id = ${exceptionId}
    `);

    res.json({ success: true, newStatus });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ success: false, error: "Stage tables not yet migrated" });
    }
    console.error("Exception action error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Client Updates ──────────────────────────────────────────

app.get("/api/gates/client-updates", jwtAuth, requireAuth, async (_req, res) => {
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
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ projects: [] });
    }
    console.error("Gates client-updates error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Handovers (enhanced for Prompt 6) ──────────────────────

app.get("/api/gates/handovers", jwtAuth, requireAuth, async (req, res) => {
  try {
    const view = (req.query.view as string) || "all";

    const result = await db.execute(sql`
      SELECT
        pi.id AS project_id,
        pi.project_name,
        pi.client_name,
        pi.pm,
        pes.construction_manager_user_id,
        pes.current_stage_code,
        pes.gate_status,
        pes.gate_readiness_pct,
        pes.waiting_on_department,
        COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_in_stage,
        hp.pack_type AS handover_type,
        COALESCE(hp.document_completeness_pct, 0) AS pack_completeness_pct,
        COALESCE(hp.open_snags_count, 0) AS open_snags,
        hp.checklist_status AS acceptance_status,
        CASE
          WHEN hp.checklist_status = 'complete' THEN 'accepted'
          WHEN COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) > 7 THEN 'overdue'
          WHEN COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) > 5 THEN 'approaching'
          ELSE 'within'
        END AS sla_status,
        COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_waiting,
        sseg.sseg_pending
      FROM project_info pi
      JOIN project_execution_state pes ON pes.project_id = pi.id
      LEFT JOIN project_stage_instances psi
        ON psi.project_id = pi.id AND psi.stage_code = pes.current_stage_code
      LEFT JOIN (
        SELECT DISTINCT ON (project_id)
          project_id, pack_type, document_completeness_pct, open_snags_count, checklist_status
        FROM handover_packs
        ORDER BY project_id, created_at DESC
      ) hp ON hp.project_id = pi.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) FILTER (WHERE status != 'approved') AS sseg_pending
        FROM sseg_items
        GROUP BY project_id
      ) sseg ON sseg.project_id = pi.id
      WHERE pes.is_active = true
        AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
        AND pes.current_stage_code IN ('S08_OM_HANDOVER', 'S09_CLIENT_HANDOVER')
      ORDER BY days_in_stage DESC
    `);

    let projects = ((result as any).rows ?? []).map((r: any) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      clientName: r.client_name,
      pm: r.pm,
      constructionManager: r.construction_manager_user_id,
      currentStageCode: r.current_stage_code,
      gateStatus: r.gate_status,
      gateReadinessPct: r.gate_readiness_pct ?? 0,
      waitingOnDepartment: r.waiting_on_department,
      daysInStage: r.days_in_stage ?? 0,
      handoverType: r.current_stage_code === "S08_OM_HANDOVER" ? "O&M" : "Client",
      packCompletenessPct: Number(r.pack_completeness_pct || 0),
      openSnags: Number(r.open_snags || 0),
      acceptanceStatus: r.acceptance_status || "pending",
      slaStatus: r.sla_status || "within",
      daysWaiting: r.days_waiting ?? 0,
      ssegPending: Number(r.sseg_pending || 0),
    }));

    // Apply view filter
    if (view === "om_queue") {
      projects = projects.filter((p: any) => p.currentStageCode === "S08_OM_HANDOVER");
    } else if (view === "client_queue") {
      projects = projects.filter((p: any) => p.currentStageCode === "S09_CLIENT_HANDOVER");
    } else if (view === "missing_docs") {
      projects = projects.filter((p: any) => p.packCompletenessPct < 100);
    } else if (view === "sseg_pending") {
      projects = projects.filter((p: any) => p.ssegPending > 0);
    } else if (view === "accepted") {
      projects = projects.filter((p: any) => p.acceptanceStatus === "complete");
    } else if (view === "waiting_matriarch") {
      projects = projects.filter((p: any) => p.currentStageCode === "S08_OM_HANDOVER" && p.waitingOnDepartment === "OM");
    } else if (view === "waiting_client") {
      projects = projects.filter((p: any) => p.currentStageCode === "S09_CLIENT_HANDOVER" && p.waitingOnDepartment === "CLIENT");
    }

    res.json({ projects });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ projects: [] });
    }
    console.error("Gates handovers error:", err);
    res.status(500).json({ error: err.message });
  }
});

} // end registerGatesRoutes
