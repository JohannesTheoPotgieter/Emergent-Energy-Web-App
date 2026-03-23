-- ============================================================
-- Prompt 9: Add Temporal Columns to Financial Tables
--
-- Adds point-in-time query capability: effective_from / effective_to / snapshot_run_id.
-- Additive only — no columns removed, no existing queries changed.
-- NULL effective_to = current/active row.
-- ============================================================

-- 1. program_expense
ALTER TABLE program_expense
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_program_expense_temporal
  ON program_expense(project_id, effective_from, effective_to);

-- 2. program_inflows
ALTER TABLE program_inflows
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_program_inflows_temporal
  ON program_inflows(project_id, effective_from, effective_to);

-- 3. cashflow_points
ALTER TABLE cashflow_points
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cashflow_points_temporal
  ON cashflow_points(project_id, effective_from, effective_to);

-- 4. finance_revenue_monthly
ALTER TABLE finance_revenue_monthly
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_revenue_monthly_temporal
  ON finance_revenue_monthly(project_id, effective_from, effective_to);

-- 5. finance_cos_monthly
ALTER TABLE finance_cos_monthly
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_cos_monthly_temporal
  ON finance_cos_monthly(project_id, effective_from, effective_to);

-- 6. project_revenue_summary
ALTER TABLE project_revenue_summary
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_project_revenue_summary_temporal
  ON project_revenue_summary(project_id, effective_from, effective_to);

-- 7. normalized_cost_lines
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_temporal
  ON normalized_cost_lines(project_id, effective_from, effective_to);

-- 8. normalized_revenue_lines
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER REFERENCES smart_import_runs(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_temporal
  ON normalized_revenue_lines(project_id, effective_from, effective_to);

COMMENT ON COLUMN program_expense.effective_from IS 'Temporal: when this row version became active (Prompt 9)';
COMMENT ON COLUMN program_expense.effective_to IS 'Temporal: when this row version was superseded (NULL = current)';
COMMENT ON COLUMN program_expense.snapshot_run_id IS 'Temporal: import run that created this version';
