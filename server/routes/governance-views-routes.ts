// ============================================================
// GOVERNANCE VIEWS ROUTES — Quality & Compliance cross-project views (Prompt 6)
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { jwtAuth, requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";

export function registerGovernanceViewsRoutes(app: Express) {

// ── Quality Governance ─────────────────────────────────────

app.get("/api/governance/quality", jwtAuth, requireAuth, async (req, res) => {
  try {
    // Cross-project quality data aggregation
    const [commissioningReviews, openSnags, qualityChecklist] = await Promise.all([
      // Commissioning reviews due (projects in S07 needing quality sign-off)
      db.execute(sql`
        SELECT
          pi.id AS project_id, pi.project_name, COALESCE(c.name, '') AS client_name, pi.pm,
          psi.readiness_pct,
          COALESCE(EXTRACT(DAY FROM NOW() - psi.started_at)::int, 0) AS days_in_stage
        FROM project_info pi
        LEFT JOIN clients c ON c.id = pi.client_id
        JOIN project_execution_state pes ON pes.project_id = pi.id
        LEFT JOIN project_stage_instances psi ON psi.project_id = pi.id AND psi.stage_code = 'S07_COMMISSIONING'
        WHERE pes.is_active = true
          AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
          AND pes.current_stage_code IN ('S07_COMMISSIONING', 'S06_CONSTRUCTION')
      `),

      // Open quality items — uses canonical qc_item_instance table with correct columns
      db.execute(sql`
        SELECT
          qi.id, cl.project_id, pi.project_name,
          qi.qm_status, qi.approved, qi.is_applicable,
          ti.item_name, ti.default_severity AS severity,
          COALESCE(EXTRACT(DAY FROM NOW() - qi.last_updated_at)::int, 0) AS age_days,
          qi.assignee_user_id AS owner_user_id,
          u.name AS owner_name
        FROM qc_item_instance qi
        JOIN qc_checklist cl ON cl.id = qi.checklist_id
        JOIN project_info pi ON pi.id = cl.project_id
        JOIN qc_template_item ti ON ti.id = qi.template_item_id
        LEFT JOIN users u ON u.id = qi.assignee_user_id
        WHERE qi.is_applicable = true
          AND qi.approved = false
          AND qi.qm_status NOT IN ('na')
        ORDER BY ti.default_severity DESC NULLS LAST, qi.last_updated_at ASC
        LIMIT 200
      `),

      // Quality checklist completion by project
      db.execute(sql`
        SELECT
          pi.id AS project_id, pi.project_name,
          COUNT(*) AS total_items,
          COUNT(*) FILTER (WHERE psr.status = 'COMPLETE') AS completed_items,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE psr.status = 'COMPLETE') * 100.0 / COUNT(*))
            ELSE 0
          END AS completion_pct
        FROM project_stage_requirements psr
        JOIN project_info pi ON pi.id = psr.project_id
        WHERE psr.department = 'QUALITY'
        GROUP BY pi.id, pi.project_name
        ORDER BY completion_pct ASC
      `),
    ]);

    res.json({
      commissioningReviews: (commissioningReviews as any).rows ?? [],
      openSnags: (openSnags as any).rows ?? [],
      qualityChecklist: (qualityChecklist as any).rows ?? [],
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ commissioningReviews: [], openSnags: [], qualityChecklist: [] });
    }
    console.error("Quality governance error:", err);
    throw err;
  }
});

// ── Quality action ─────────────────────────────────────────

app.patch("/api/governance/quality/:id/action", jwtAuth, requireAuth, requirePermission("quality", "approve"), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { action, assignToUserId, notes } = req.body;

    // Use canonical qc_item_instance table with correct column names and status values
    if (action === "close") {
      await db.execute(sql`
        UPDATE qc_item_instance SET qm_status = 'na', is_applicable = false, approved = false, last_updated_at = NOW() WHERE id = ${itemId}
      `);
    } else if (action === "assign" && assignToUserId) {
      await db.execute(sql`
        UPDATE qc_item_instance SET assignee_user_id = ${assignToUserId}, last_updated_at = NOW() WHERE id = ${itemId}
      `);
    } else if (action === "approve") {
      await db.execute(sql`
        UPDATE qc_item_instance SET qm_status = 'pass', approved = true, approved_at = NOW(), last_updated_at = NOW() WHERE id = ${itemId}
      `);
    } else if (action === "reject") {
      await db.execute(sql`
        UPDATE qc_item_instance SET qm_status = 'fail', approved = false, last_updated_at = NOW() WHERE id = ${itemId}
      `);
    }

    res.json({ success: true });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ success: false, error: "Stage tables not yet migrated" });
    }
    console.error("Quality action error:", err);
    throw err;
  }
});

// ── Compliance Governance ──────────────────────────────────

app.get("/api/governance/compliance", jwtAuth, requireAuth, async (req, res) => {
  try {
    const [ssegByProject, authoritySubmissions, rmaItems] = await Promise.all([
      // SSEG items by project
      db.execute(sql`
        SELECT
          si.id, si.project_id, pi.project_name,
          si.item_type, si.authority, si.reference_number,
          si.submitted_date, si.expected_date, si.actual_date,
          si.status,
          CASE WHEN si.submitted_date IS NOT NULL AND si.actual_date IS NULL
               AND si.expected_date < CURRENT_DATE
            THEN true ELSE false
          END AS is_overdue,
          CASE WHEN si.submitted_date IS NOT NULL AND si.actual_date IS NULL
            THEN COALESCE(EXTRACT(DAY FROM NOW() - si.submitted_date)::int, 0)
            ELSE 0
          END AS days_since_submission
        FROM sseg_items si
        JOIN project_info pi ON pi.id = si.project_id
        ORDER BY is_overdue DESC, si.submitted_date ASC NULLS LAST
      `),

      // Authority submissions tracker
      db.execute(sql`
        SELECT
          si.authority,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE si.status = 'approved') AS approved,
          COUNT(*) FILTER (WHERE si.status = 'submitted') AS pending,
          COUNT(*) FILTER (WHERE si.submitted_date IS NOT NULL AND si.actual_date IS NULL AND si.expected_date < CURRENT_DATE) AS overdue
        FROM sseg_items si
        GROUP BY si.authority
      `),

      // Metering/Techsitter confirmations pending
      db.execute(sql`
        SELECT
          pi.id AS project_id, pi.project_name,
          pes.current_stage_code,
          bool_or(psr.item_code LIKE '%metering%' OR psr.item_code LIKE '%techsitter%') AS has_metering_items,
          COUNT(*) FILTER (WHERE (psr.item_code LIKE '%metering%' OR psr.item_code LIKE '%techsitter%') AND psr.status != 'COMPLETE') AS pending_metering_count
        FROM project_info pi
        JOIN project_execution_state pes ON pes.project_id = pi.id
        LEFT JOIN project_stage_requirements psr ON psr.project_id = pi.id AND psr.department = 'COMPLIANCE'
        WHERE pes.is_active = true AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
        GROUP BY pi.id, pi.project_name, pes.current_stage_code
        HAVING COUNT(*) FILTER (WHERE (psr.item_code LIKE '%metering%' OR psr.item_code LIKE '%techsitter%') AND psr.status != 'COMPLETE') > 0
      `),
    ]);

    res.json({
      ssegByProject: (ssegByProject as any).rows ?? [],
      authoritySubmissions: (authoritySubmissions as any).rows ?? [],
      meteringPending: (rmaItems as any).rows ?? [],
    });
  } catch (err: any) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.json({ ssegByProject: [], authoritySubmissions: [], meteringPending: [] });
    }
    console.error("Compliance governance error:", err);
    throw err;
  }
});

// ── Compliance action ──────────────────────────────────────

app.patch("/api/governance/compliance/:id/action", jwtAuth, requireAuth, async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { action, status } = req.body;

    if (action === "update_status" && status) {
      await db.execute(sql`UPDATE sseg_items SET status = ${status}, updated_at = NOW() WHERE id = ${itemId}`);
    } else if (action === "mark_complete") {
      await db.execute(sql`UPDATE sseg_items SET status = 'approved', actual_date = CURRENT_DATE, updated_at = NOW() WHERE id = ${itemId}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Compliance action error:", err);
    throw err;
  }
});

} // end registerGovernanceViewsRoutes
