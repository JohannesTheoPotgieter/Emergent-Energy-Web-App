-- ============================================================
-- Rollback: Database Integrity Hardening (QA Sweep 01 fixes)
-- ============================================================

-- ── 1. Drop temporal CHECK constraints ───────────────────────────────────
ALTER TABLE program_expense DROP CONSTRAINT IF EXISTS chk_program_expense_temporal;
ALTER TABLE program_inflows DROP CONSTRAINT IF EXISTS chk_program_inflows_temporal;
ALTER TABLE cashflow_points DROP CONSTRAINT IF EXISTS chk_cashflow_points_temporal;
ALTER TABLE finance_revenue_monthly DROP CONSTRAINT IF EXISTS chk_finance_revenue_monthly_temporal;
ALTER TABLE finance_cos_monthly DROP CONSTRAINT IF EXISTS chk_finance_cos_monthly_temporal;
ALTER TABLE project_revenue_summary DROP CONSTRAINT IF EXISTS chk_project_revenue_summary_temporal;
ALTER TABLE normalized_cost_lines DROP CONSTRAINT IF EXISTS chk_normalized_cost_lines_temporal;
ALTER TABLE normalized_revenue_lines DROP CONSTRAINT IF EXISTS chk_normalized_revenue_lines_temporal;

-- ── 2. Drop import snapshot CHECK constraints ────────────────────────────
ALTER TABLE program_expense DROP CONSTRAINT IF EXISTS chk_program_expense_snapshot;
ALTER TABLE program_inflows DROP CONSTRAINT IF EXISTS chk_program_inflows_snapshot;
ALTER TABLE project_plan DROP CONSTRAINT IF EXISTS chk_project_plan_snapshot;
ALTER TABLE cashflow_points DROP CONSTRAINT IF EXISTS chk_cashflow_points_snapshot;
ALTER TABLE finance_revenue_monthly DROP CONSTRAINT IF EXISTS chk_finance_revenue_monthly_snapshot;
ALTER TABLE finance_cos_monthly DROP CONSTRAINT IF EXISTS chk_finance_cos_monthly_snapshot;

-- ── 3. Revert financial project_id to nullable ───────────────────────────
ALTER TABLE program_expense ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE program_inflows ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_plan ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE cashflow_points ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE finance_revenue_monthly ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE finance_cos_monthly ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_revenue_summary ALTER COLUMN project_id DROP NOT NULL;

-- ── 4. Revert work_items.created_by to nullable ─────────────────────────
ALTER TABLE work_items ALTER COLUMN created_by DROP NOT NULL;

-- ── 5. Re-add legacy task_id columns (nullable, no FK) ──────────────────
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE task_checklists ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE task_deliverables ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE task_activity_log ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE task_watchers ADD COLUMN IF NOT EXISTS task_id INTEGER;

-- Revert work_item_id to nullable
ALTER TABLE task_comments ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE task_checklists ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE task_attachments ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE task_deliverables ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE task_activity_log ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE task_watchers ALTER COLUMN work_item_id DROP NOT NULL;

-- ── 6 & 7. Backfilled rows are NOT removed (safe to keep). ──────────────
-- No-op: 1:1 child rows and dashboard_project_metrics rows are harmless.
