-- ============================================================
-- Rollback: Prompt 9 — Temporal Financial Columns
--
-- Removes effective_from, effective_to, snapshot_run_id from all 8 tables.
-- No data loss — these columns are metadata only.
-- ============================================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_program_expense_temporal;
DROP INDEX IF EXISTS idx_program_inflows_temporal;
DROP INDEX IF EXISTS idx_cashflow_points_temporal;
DROP INDEX IF EXISTS idx_finance_revenue_monthly_temporal;
DROP INDEX IF EXISTS idx_finance_cos_monthly_temporal;
DROP INDEX IF EXISTS idx_project_revenue_summary_temporal;
DROP INDEX IF EXISTS idx_normalized_cost_lines_temporal;
DROP INDEX IF EXISTS idx_normalized_revenue_lines_temporal;

-- Drop columns
ALTER TABLE program_expense DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE program_inflows DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE cashflow_points DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE finance_revenue_monthly DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE finance_cos_monthly DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE project_revenue_summary DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE normalized_cost_lines DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
ALTER TABLE normalized_revenue_lines DROP COLUMN IF EXISTS effective_from, DROP COLUMN IF EXISTS effective_to, DROP COLUMN IF EXISTS snapshot_run_id;
