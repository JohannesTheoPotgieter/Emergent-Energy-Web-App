-- =========================================================================
-- Tier 4 · PR 3: extend priority_derived_metrics with cross-department
-- signals. Adds three new aggregate columns so the priority health engine
-- can fold in:
--   - engineering gate blockers  (project_eng_stages.status = 'blocked')
--   - open quality defects       (qc_item_instance not approved, active checklist)
--   - open HSE incidents         (hse_incidents not closed, high+ severity)
--
-- CREATE OR REPLACE VIEW so the migration is idempotent and safe to re-apply.
-- =========================================================================

CREATE OR REPLACE VIEW priority_derived_metrics AS
SELECT
  cp.id AS priority_id,

  -- Project counts
  COUNT(DISTINCT pp.project_id) AS project_count,
  COUNT(DISTINCT CASE
    WHEN LOWER(pes.rag_status) IN ('red') THEN pp.project_id
  END) AS at_risk_project_count,

  -- Derived health: worst-of across all linked project RAG indicators.
  -- NOTE: callers additionally fold in overdue / severity / blocker /
  --       dept-signal signals in `enrichPriority`, so this is only one input.
  CASE
    WHEN bool_or(LOWER(pes.rag_status) = 'red') THEN 'critical'
    WHEN bool_or(LOWER(pes.rag_status) IN ('amber', 'orange')) THEN 'at_risk'
    WHEN COUNT(DISTINCT pp.project_id) = 0 THEN NULL
    ELSE 'healthy'
  END AS derived_health,

  -- Financial aggregation from derived_project_kpis
  COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0) AS total_revenue,
  COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_cos,
  COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0)
    - COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_gp,

  -- Progress: average % complete across linked projects
  COALESCE(AVG(CAST(dpk.avg_actual_pct_complete AS NUMERIC)), 0) AS avg_progress,

  -- Blocker count: work_items with status containing 'block' in linked projects
  (SELECT COUNT(*) FROM work_items wi
   WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND (LOWER(wi.status) LIKE '%block%')
   AND wi.deleted_at IS NULL) AS blocker_count,

  -- Open task count: work_items not done/cancelled in linked projects
  (SELECT COUNT(*) FROM work_items wi
   WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND LOWER(wi.status) NOT IN ('complete', 'completed', 'done', 'cancelled', 'canceled', 'qc approved')
   AND wi.deleted_at IS NULL) AS open_task_count,

  -- Engineering gate blockers: project_eng_stages stuck in 'blocked' state.
  -- ENGINEERING department signal — a stalled stage gate must bubble up to
  -- the priority it feeds.
  (SELECT COUNT(*) FROM project_eng_stages pes_b
   WHERE pes_b.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND pes_b.status = 'blocked') AS eng_blocker_count,

  -- Open quality defects: qc_item_instance rows in active checklists that
  -- are not approved, not marked not-applicable, and not already complete.
  -- QUALITY department signal.
  (SELECT COUNT(*) FROM qc_item_instance qci
   JOIN qc_checklist qcc ON qcc.id = qci.checklist_id
   WHERE qcc.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND qcc.status = 'active'
   AND qci.is_applicable = true
   AND qci.approved = false
   AND LOWER(qci.qm_status) NOT IN ('approved', 'complete', 'completed', 'done', 'cancelled')
  ) AS quality_defect_count,

  -- Open HSE incidents at high or critical severity. HSE signal — any such
  -- incident drives the priority to at_risk at minimum, critical if severity=critical.
  (SELECT COUNT(*) FROM hse_incidents hi
   WHERE hi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND LOWER(COALESCE(hi.status, 'open')) <> 'closed'
   AND LOWER(hi.severity) IN ('high', 'critical')
   AND hi.deleted_at IS NULL) AS hse_incident_count,

  -- HSE critical-only count, surfaced separately so the health rule can
  -- flip to 'critical' specifically when there is a life-safety issue.
  (SELECT COUNT(*) FROM hse_incidents hi
   WHERE hi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND LOWER(COALESCE(hi.status, 'open')) <> 'closed'
   AND LOWER(hi.severity) = 'critical'
   AND hi.deleted_at IS NULL) AS hse_critical_count

FROM mytool_company_priorities cp
LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
GROUP BY cp.id;
