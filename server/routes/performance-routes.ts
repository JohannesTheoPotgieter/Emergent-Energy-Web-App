// ============================================================
// PERFORMANCE & REPORTS ROUTES (Prompt 6)
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { jwtAuth, requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";

export function registerPerformanceRoutes(app: Express) {

// ── Performance V1 ─────────────────────────────────────────

app.get("/api/performance/v1", jwtAuth, requireAuth, requirePermission("performance", "view"), async (_req, res) => {
  try {
    const [stageDuration, projectCompletion, stageDistribution] = await Promise.all([
      // Average stage duration by stage
      db.execute(sql`
        SELECT
          psi.stage_code,
          COUNT(*) AS project_count,
          ROUND(AVG(EXTRACT(DAY FROM COALESCE(psi.completed_at, NOW()) - psi.started_at)))::int AS avg_days,
          MIN(EXTRACT(DAY FROM COALESCE(psi.completed_at, NOW()) - psi.started_at))::int AS min_days,
          MAX(EXTRACT(DAY FROM COALESCE(psi.completed_at, NOW()) - psi.started_at))::int AS max_days
        FROM project_stage_instances psi
        WHERE psi.started_at IS NOT NULL
        GROUP BY psi.stage_code
        ORDER BY psi.stage_code
      `),

      // Projects on-time vs late (based on target exit date)
      db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE psi.completed_at IS NOT NULL) AS completed,
          COUNT(*) FILTER (
            WHERE psi.completed_at IS NOT NULL
            AND psi.target_exit_date IS NOT NULL
            AND psi.completed_at::date <= psi.target_exit_date::date
          ) AS on_time,
          COUNT(*) FILTER (
            WHERE psi.completed_at IS NOT NULL
            AND psi.target_exit_date IS NOT NULL
            AND psi.completed_at::date > psi.target_exit_date::date
          ) AS late
        FROM project_stage_instances psi
        WHERE psi.stage_status IN ('APPROVED', 'PROGRESSED')
      `),

      // Projects by current stage (pipeline distribution)
      db.execute(sql`
        SELECT
          pes.current_stage_code AS stage_code,
          COUNT(*) AS count
        FROM project_execution_state pes
        WHERE pes.is_active = true AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
        GROUP BY pes.current_stage_code
        ORDER BY pes.current_stage_code
      `),
    ]);

    // Commissioning done vs planned
    const commissioningResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE stage_status IN ('APPROVED', 'PROGRESSED')) AS done,
        COUNT(*) FILTER (WHERE target_exit_date IS NOT NULL AND target_exit_date <= CURRENT_DATE) AS planned_by_now,
        COUNT(*) AS total
      FROM project_stage_instances
      WHERE stage_code = 'S07_COMMISSIONING'
        AND started_at IS NOT NULL
    `);

    // 3-month reviews completed vs due
    const reviewsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE stage_status IN ('APPROVED', 'PROGRESSED')) AS completed,
        COUNT(*) FILTER (WHERE stage_status NOT IN ('NOT_STARTED')) AS due,
        COUNT(*) AS total
      FROM project_stage_instances
      WHERE stage_code = 'S10_POST_HANDOVER_REVIEW'
    `);

    // Repeat issues count (based on exception patterns)
    const repeatIssuesResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE reason_text ILIKE '%metering%') AS metering_problems,
        COUNT(*) FILTER (WHERE reason_text ILIKE '%sseg%' OR reason_text ILIKE '%delay%') AS sseg_delays,
        COUNT(*) FILTER (WHERE reason_text ILIKE '%scope%' OR reason_text ILIKE '%drift%') AS scope_drift,
        COUNT(*) FILTER (WHERE reason_text ILIKE '%quality%' OR reason_text ILIKE '%defect%') AS quality_defects,
        COUNT(*) FILTER (WHERE reason_text ILIKE '%installer%') AS installer_issues
      FROM project_stage_exceptions
    `);

    res.json({
      stageDuration: (stageDuration as any).rows ?? [],
      projectCompletion: ((projectCompletion as any).rows ?? [])[0] || {},
      stageDistribution: (stageDistribution as any).rows ?? [],
      commissioning: ((commissioningResult as any).rows ?? [])[0] || {},
      reviews: ((reviewsResult as any).rows ?? [])[0] || {},
      repeatIssues: ((repeatIssuesResult as any).rows ?? [])[0] || {},
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({
        stageDuration: [],
        projectCompletion: {},
        stageDistribution: [],
        commissioning: {},
        reviews: {},
        repeatIssues: {},
      });
    }
    console.error("Performance V1 error:", err);
    throw err;
  }
});

// ── Gate Reports ───────────────────────────────────────────

app.get("/api/reports/gate-reports", jwtAuth, requireAuth, requirePermission("performance", "view"), async (_req, res) => {
  try {
    const [blockedGates, exceptionAgeing] = await Promise.all([
      // Blocked gates with age and owner
      db.execute(sql`
        SELECT
          pi.project_name, psi.stage_code,
          psi.stage_owner_user_id AS owner_user_id,
          u.name AS owner_name,
          COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_blocked,
          pes.waiting_on_department
        FROM project_stage_instances psi
        JOIN project_info pi ON pi.id = psi.project_id
        JOIN project_execution_state pes ON pes.project_id = pi.id
        LEFT JOIN users u ON u.id = psi.stage_owner_user_id
        WHERE psi.stage_status = 'BLOCKED'
        ORDER BY days_blocked DESC
      `),

      // Exception ageing by risk level
      db.execute(sql`
        SELECT
          risk_level,
          COUNT(*) AS count,
          ROUND(AVG(EXTRACT(DAY FROM NOW() - created_at)))::int AS avg_age,
          MAX(EXTRACT(DAY FROM NOW() - created_at))::int AS max_age
        FROM project_stage_exceptions
        WHERE status IN ('REQUESTED', 'RE_OPENED')
        GROUP BY risk_level
        ORDER BY
          CASE risk_level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END
      `),
    ]);

    res.json({
      blockedGates: (blockedGates as any).rows ?? [],
      exceptionAgeing: (exceptionAgeing as any).rows ?? [],
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ blockedGates: [], exceptionAgeing: [] });
    }
    console.error("Gate reports error:", err);
    throw err;
  }
});

// ── Operational Reports ────────────────────────────────────

app.get("/api/reports/operational", jwtAuth, requireAuth, requirePermission("performance", "view"), async (_req, res) => {
  try {
    const [commissioningQueue, handoverQueue, weeklyCompliance] = await Promise.all([
      // Commissioning queue
      db.execute(sql`
        SELECT
          pi.project_name, COALESCE(c.name, '') AS client_name, pi.pm,
          psi.stage_status, psi.readiness_pct,
          psi.target_exit_date AS planned_date,
          COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_in_stage
        FROM project_stage_instances psi
        JOIN project_info pi ON pi.id = psi.project_id
        LEFT JOIN clients c ON c.id = pi.client_id
        WHERE psi.stage_code = 'S07_COMMISSIONING'
          AND psi.stage_status NOT IN ('NOT_STARTED', 'PROGRESSED')
        ORDER BY psi.target_exit_date ASC NULLS LAST
      `),

      // Handover queue (O&M + Client)
      db.execute(sql`
        SELECT
          pi.project_name, COALESCE(c.name, '') AS client_name, pi.pm,
          psi.stage_code, psi.stage_status, psi.readiness_pct,
          COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_in_stage
        FROM project_stage_instances psi
        JOIN project_info pi ON pi.id = psi.project_id
        LEFT JOIN clients c ON c.id = pi.client_id
        WHERE psi.stage_code IN ('S08_OM_HANDOVER', 'S09_CLIENT_HANDOVER')
          AND psi.stage_status NOT IN ('NOT_STARTED', 'PROGRESSED')
        ORDER BY psi.stage_code, days_in_stage DESC
      `),

      // Weekly client updates compliance
      db.execute(sql`
        SELECT
          pi.project_name, pi.pm,
          pes.current_stage_code,
          wr.last_review_date,
          CASE WHEN wr.last_review_date IS NULL THEN 'never'
               WHEN wr.last_review_date < NOW() - INTERVAL '7 days' THEN 'overdue'
               ELSE 'on_time'
          END AS compliance_status
        FROM project_info pi
        JOIN project_execution_state pes ON pes.project_id = pi.id
        LEFT JOIN (
          SELECT project_id, MAX(created_at) AS last_review_date
          FROM weekly_reviews
          GROUP BY project_id
        ) wr ON wr.project_id = pi.id
        WHERE pes.is_active = true
          AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
          -- Post-merge: include S03 (the merged Financial Close) and keep
          -- S04/S05 in the IN-list for any rows that haven't been migrated.
          AND pes.current_stage_code IN ('S03_SIGNATURE_FINANCIAL_CLOSE','S04_PD_PM_HANDOVER','S05_FINANCIAL_REVIEW','S06_CONSTRUCTION','S07_COMMISSIONING','S08_OM_HANDOVER','S09_CLIENT_HANDOVER')
        ORDER BY wr.last_review_date ASC NULLS FIRST
      `),
    ]);

    res.json({
      commissioningQueue: (commissioningQueue as any).rows ?? [],
      handoverQueue: (handoverQueue as any).rows ?? [],
      weeklyCompliance: (weeklyCompliance as any).rows ?? [],
    });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "42P01" || pgCode === "42703") {
      return res.json({ commissioningQueue: [], handoverQueue: [], weeklyCompliance: [] });
    }
    console.error("Operational reports error:", err);
    throw err;
  }
});

// ── Quality & Compliance Reports ───────────────────────────

app.get("/api/reports/quality-compliance", jwtAuth, requireAuth, requirePermission("performance", "view"), async (_req, res) => {
  try {
    const [qualityBlockers, complianceBlockers] = await Promise.all([
      // Quality blockers by project and stage
      db.execute(sql`
        SELECT
          pi.project_name, psr.stage_code,
          COUNT(*) AS blocker_count
        FROM project_stage_requirements psr
        JOIN project_info pi ON pi.id = psr.project_id
        WHERE psr.department = 'QUALITY'
          AND psr.blocks_gate = true
          AND psr.status NOT IN ('COMPLETE', 'NOT_APPLICABLE', 'WAIVED')
        GROUP BY pi.project_name, psr.stage_code
        ORDER BY blocker_count DESC
      `),

      // Compliance blockers by project and stage
      db.execute(sql`
        SELECT
          pi.project_name, psr.stage_code,
          COUNT(*) AS blocker_count
        FROM project_stage_requirements psr
        JOIN project_info pi ON pi.id = psr.project_id
        WHERE psr.department = 'COMPLIANCE'
          AND psr.blocks_gate = true
          AND psr.status NOT IN ('COMPLETE', 'NOT_APPLICABLE', 'WAIVED')
        GROUP BY pi.project_name, psr.stage_code
        ORDER BY blocker_count DESC
      `),
    ]);

    res.json({
      qualityBlockers: (qualityBlockers as any).rows ?? [],
      complianceBlockers: (complianceBlockers as any).rows ?? [],
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ qualityBlockers: [], complianceBlockers: [] });
    }
    console.error("Quality-compliance reports error:", err);
    throw err;
  }
});

} // end registerPerformanceRoutes
