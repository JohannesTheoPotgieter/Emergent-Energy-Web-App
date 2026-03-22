-- ============================================================
-- Prompt 12: Dashboard Metrics Materialized Tables
--
-- Creates dashboard_project_metrics and dashboard_program_metrics
-- for pre-computed dashboard aggregations.
-- ============================================================

-- Step 1: Project-level materialized metrics
CREATE TABLE IF NOT EXISTS dashboard_project_metrics (
  id SERIAL PRIMARY KEY,
  project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  -- Financial aggregates
  total_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
  received_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
  outstanding_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  outstanding_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  margin_pct NUMERIC(8,4),
  -- Task aggregates
  task_count INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_in_progress INTEGER NOT NULL DEFAULT 0,
  tasks_overdue INTEGER NOT NULL DEFAULT 0,
  tasks_active INTEGER NOT NULL DEFAULT 0,
  -- QC aggregates
  open_warnings INTEGER NOT NULL DEFAULT 0,
  qc_progress_pct NUMERIC(8,4),
  -- Snapshot of current state
  health_score NUMERIC(5,2),
  phase TEXT,
  rag_status TEXT,
  contract_value NUMERIC(15,2),
  project_name TEXT,
  pm TEXT,
  pd TEXT,
  -- Metadata
  last_refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpm_project_id ON dashboard_project_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_dpm_phase ON dashboard_project_metrics(phase);
CREATE INDEX IF NOT EXISTS idx_dpm_rag_status ON dashboard_project_metrics(rag_status);

-- Step 2: Program-level materialized metrics
CREATE TABLE IF NOT EXISTS dashboard_program_metrics (
  id SERIAL PRIMARY KEY,
  total_projects INTEGER NOT NULL DEFAULT 0,
  active_projects INTEGER NOT NULL DEFAULT 0,
  total_program_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_program_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  received_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  avg_margin NUMERIC(8,4),
  projects_at_risk INTEGER NOT NULL DEFAULT 0,
  total_tasks_overdue INTEGER NOT NULL DEFAULT 0,
  total_open_warnings INTEGER NOT NULL DEFAULT 0,
  last_refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- organization_id removed (organizations multi-tenancy rolled back)
