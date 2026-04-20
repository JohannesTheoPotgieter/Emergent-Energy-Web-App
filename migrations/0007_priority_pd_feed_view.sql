-- =========================================================================
-- Tier 4 · PR 2: extend priority_derived_metrics with Project Development
-- signals. Adds three new aggregates so the health engine can fold in:
--   - linked opportunity count
--   - stale opportunities  (>60d without a stage change, or past expected_close_date)
--   - open PD tickets      (pd_tickets linked to any linked opportunity, not closed)
--
-- CREATE OR REPLACE VIEW — idempotent; safe to re-apply.
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

  -- ENGINEERING signal — blocked gates on linked projects
  (SELECT COUNT(*) FROM project_eng_stages pes_b
   WHERE pes_b.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND pes_b.status = 'blocked') AS eng_blocker_count,

  -- QUALITY signal — open QC defects on linked projects
  (SELECT COUNT(*) FROM qc_item_instance qci
   JOIN qc_checklist qcc ON qcc.id = qci.checklist_id
   WHERE qcc.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND qcc.status = 'active'
   AND qci.is_applicable = true
   AND qci.approved = false
   AND LOWER(qci.qm_status) NOT IN ('approved', 'complete', 'completed', 'done', 'cancelled')
  ) AS quality_defect_count,

  -- HSE signal — high/critical open incidents on linked projects
  (SELECT COUNT(*) FROM hse_incidents hi
   WHERE hi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND LOWER(COALESCE(hi.status, 'open')) <> 'closed'
   AND LOWER(hi.severity) IN ('high', 'critical')
   AND hi.deleted_at IS NULL) AS hse_incident_count,

  -- HSE critical-only count
  (SELECT COUNT(*) FROM hse_incidents hi
   WHERE hi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
   AND LOWER(COALESCE(hi.status, 'open')) <> 'closed'
   AND LOWER(hi.severity) = 'critical'
   AND hi.deleted_at IS NULL) AS hse_critical_count,

  -- ============ PROJECT DEVELOPMENT signals (Tier 4 · PR 2) ============

  -- Count of pre-contract opportunities linked to this priority
  (SELECT COUNT(*) FROM priority_opportunities pop
   WHERE pop.priority_id = cp.id) AS opportunity_count,

  -- Stale opportunities: linked AND (stuck > 60 days in current stage OR past expected close date)
  -- and not yet won/lost.
  (SELECT COUNT(*) FROM priority_opportunities pop
   JOIN opportunities op ON op.id = pop.opportunity_id
   WHERE pop.priority_id = cp.id
   AND LOWER(COALESCE(op.stage, 'prospect')) NOT IN ('won', 'lost')
   AND (
     (op.pipedrive_stage_changed_at IS NOT NULL
       AND op.pipedrive_stage_changed_at < NOW() - INTERVAL '60 days')
     OR (op.expected_close_date IS NOT NULL
       AND op.expected_close_date < CURRENT_DATE)
   )
  ) AS stale_opportunity_count,

  -- Open PD tickets tied to any linked opportunity — stalled feasibility
  -- studies, open cost proposals, grid applications. Exclude closed/done.
  (SELECT COUNT(*) FROM pd_tickets pdt
   WHERE pdt.opportunity_id IN (
     SELECT opportunity_id FROM priority_opportunities WHERE priority_id = cp.id
   )
   AND LOWER(COALESCE(pdt.status, 'draft')) NOT IN ('closed', 'complete', 'completed', 'done', 'cancelled', 'rejected')
  ) AS open_pd_ticket_count

FROM mytool_company_priorities cp
LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
GROUP BY cp.id;
