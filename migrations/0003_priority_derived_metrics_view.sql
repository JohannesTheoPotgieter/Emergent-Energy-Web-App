-- =========================================================================
-- Re-establish the priority_derived_metrics view in all environments.
--
-- The view was originally introduced in migrations/archive/20260342_company_
-- priorities_strategic_layer.sql but was not carried forward into the
-- post-baseline migration set. Production already has it (applied pre-
-- baseline); fresh dev / CI / disaster-recovery environments did not — so
-- every finance/progress/blocker metric silently returned 0. CREATE OR
-- REPLACE VIEW is idempotent, so running this on an environment that
-- already has it is safe.
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
  -- NOTE: callers additionally fold in overdue / severity / blocker signals
  -- in `enrichPriority` on the server, so this is only one input.
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
   AND wi.deleted_at IS NULL) AS open_task_count

FROM mytool_company_priorities cp
LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
GROUP BY cp.id;
