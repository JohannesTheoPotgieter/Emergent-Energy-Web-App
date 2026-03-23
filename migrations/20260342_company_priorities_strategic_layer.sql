-- ============================================================
-- Company Priorities Strategic Layer
-- Transforms priorities from flat CRUD to strategic alignment.
-- Adds new columns, priority_projects junction table, and
-- priority_derived_metrics materialized view.
-- ============================================================

-- ── 1. ALTER mytool_company_priorities ──────────────────────────

-- Add accountable_exec_id FK to users
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS accountable_exec_id INTEGER REFERENCES users(id);

-- Add owner_user_id FK to users (replacing text assigned_to for structured ownership)
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);

-- Add target_start_date
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS target_start_date TEXT;

-- Add target_outcome
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS target_outcome TEXT;

-- Add sort_order with default
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Add manual_health for standalone priorities
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS manual_health TEXT;

-- Add manual_progress for standalone priorities (0-100)
ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS manual_progress INTEGER;

-- Add CHECK constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_manual_health_values'
  ) THEN
    ALTER TABLE mytool_company_priorities
      ADD CONSTRAINT chk_manual_health_values
      CHECK (manual_health IS NULL OR manual_health IN ('healthy', 'at_risk', 'critical'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_manual_progress_range'
  ) THEN
    ALTER TABLE mytool_company_priorities
      ADD CONSTRAINT chk_manual_progress_range
      CHECK (manual_progress IS NULL OR (manual_progress >= 0 AND manual_progress <= 100));
  END IF;
END $$;

-- ── 2. CREATE priority_projects junction table ─────────────────

CREATE TABLE IF NOT EXISTS priority_projects (
  id SERIAL PRIMARY KEY,
  priority_id INTEGER NOT NULL REFERENCES mytool_company_priorities(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  linked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(priority_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_priority_projects_priority_id ON priority_projects(priority_id);
CREATE INDEX IF NOT EXISTS idx_priority_projects_project_id ON priority_projects(project_id);

-- ── 3. CREATE priority_derived_metrics VIEW ────────────────────
-- Uses single rag_status from project_execution_state (no separate schedule/cost/quality RAGs)
-- Financial data from derived_project_kpis
-- Task data from work_items

CREATE OR REPLACE VIEW priority_derived_metrics AS
SELECT
  cp.id AS priority_id,

  -- Project counts
  COUNT(DISTINCT pp.project_id) AS project_count,
  COUNT(DISTINCT CASE
    WHEN LOWER(pes.rag_status) IN ('red') THEN pp.project_id
  END) AS at_risk_project_count,

  -- Derived health: worst-of across all linked project RAG indicators
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

-- ── 4. Backfill owner_user_id from assigned_to text ────────────
-- Attempt to match assigned_to text to users.name
UPDATE mytool_company_priorities mcp
SET owner_user_id = u.id
FROM users u
WHERE mcp.assigned_to IS NOT NULL
  AND mcp.owner_user_id IS NULL
  AND LOWER(TRIM(mcp.assigned_to)) = LOWER(TRIM(u.name));
