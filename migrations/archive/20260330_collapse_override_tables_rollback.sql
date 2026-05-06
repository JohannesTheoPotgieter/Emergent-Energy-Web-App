-- ============================================================
-- Rollback: Collapse Override Tables Into Base Tables
--
-- This rollback:
--   1. Restores base rows from import_snapshot JSONB
--   2. Resets source/edit-tracking columns
--   3. Drops the new columns from base tables
--   4. Drops tracking tables
--   5. Drops the row_source enum
--
-- Override tables are NOT touched (they were never dropped).
-- ============================================================

-- Step 1: Restore program_expense rows that were edited by overrides
UPDATE program_expense
SET
  -- Restore all snapshot fields (these are the original imported values)
  -- We use a JSONB → column approach since import_snapshot stores the full row
  line_status = COALESCE(import_snapshot->>'line_status', line_status),
  source = 'imported',
  import_snapshot = NULL,
  last_edited_by = NULL,
  last_edited_at = NULL
WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL;

-- For program_expense rows with field-level overrides, we need to restore from snapshot
-- The snapshot contains ALL original column values, so we restore them generically
DO $$
DECLARE
  r RECORD;
  snap jsonb;
BEGIN
  FOR r IN SELECT id, import_snapshot FROM program_expense WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL
  LOOP
    snap := r.import_snapshot;
    UPDATE program_expense SET
      expense_category = COALESCE(snap->>'expense_category', expense_category),
      expense_line_item = COALESCE(snap->>'expense_line_item', expense_line_item),
      budget_qty = COALESCE((snap->>'budget_qty')::decimal, budget_qty),
      budget_rate_unit = COALESCE((snap->>'budget_rate_unit')::decimal, budget_rate_unit),
      budget_total = COALESCE((snap->>'budget_total')::decimal, budget_total),
      forecast_payment_date = COALESCE(snap->>'forecast_payment_date', forecast_payment_date),
      expense_actual_total = COALESCE((snap->>'expense_actual_total')::decimal, expense_actual_total),
      expense_po_number = COALESCE(snap->>'expense_po_number', expense_po_number),
      expense_invoice_number = COALESCE(snap->>'expense_invoice_number', expense_invoice_number),
      expense_invoiced_date = COALESCE(snap->>'expense_invoiced_date', expense_invoiced_date),
      expense_payment_date = COALESCE(snap->>'expense_payment_date', expense_payment_date),
      line_status = COALESCE(snap->>'line_status', line_status),
      source = 'imported',
      import_snapshot = NULL,
      last_edited_by = NULL,
      last_edited_at = NULL
    WHERE id = r.id;
  END LOOP;
END $$;

-- Step 2: Restore program_inflows
DO $$
DECLARE
  r RECORD;
  snap jsonb;
BEGIN
  FOR r IN SELECT id, import_snapshot FROM program_inflows WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL
  LOOP
    snap := r.import_snapshot;
    UPDATE program_inflows SET
      milestone_no = COALESCE(snap->>'milestone_no', milestone_no),
      milestone_name = COALESCE(snap->>'milestone_name', milestone_name),
      milestone_percent = COALESCE((snap->>'milestone_percent')::decimal, milestone_percent),
      milestone_amount = COALESCE((snap->>'milestone_amount')::decimal, milestone_amount),
      planned_payment_date = COALESCE(snap->>'planned_payment_date', planned_payment_date),
      milestone_invoice_number = COALESCE(snap->>'milestone_invoice_number', milestone_invoice_number),
      invoice_raised_date = COALESCE(snap->>'invoice_raised_date', invoice_raised_date),
      payment_received_date = COALESCE(snap->>'payment_received_date', payment_received_date),
      source = 'imported',
      import_snapshot = NULL,
      last_edited_by = NULL,
      last_edited_at = NULL
    WHERE id = r.id;
  END LOOP;
END $$;

-- Step 3: Restore cashflow_points
UPDATE cashflow_points
SET value = COALESCE((import_snapshot->>'value')::decimal, value),
    source = 'imported',
    import_snapshot = NULL,
    last_edited_by = NULL,
    last_edited_at = NULL
WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL;

-- Step 4: Restore finance_revenue_monthly
UPDATE finance_revenue_monthly
SET value = COALESCE((import_snapshot->>'value')::decimal, value),
    source = 'imported',
    import_snapshot = NULL,
    last_edited_by = NULL,
    last_edited_at = NULL
WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL;

-- Step 5: Restore finance_cos_monthly
UPDATE finance_cos_monthly
SET value = COALESCE((import_snapshot->>'value')::decimal, value),
    source = 'imported',
    import_snapshot = NULL,
    last_edited_by = NULL,
    last_edited_at = NULL
WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL;

-- Step 6: Restore project_plan
DO $$
DECLARE
  r RECORD;
  snap jsonb;
BEGIN
  FOR r IN SELECT id, import_snapshot FROM project_plan WHERE source = 'imported_edited' AND import_snapshot IS NOT NULL
  LOOP
    snap := r.import_snapshot;
    UPDATE project_plan SET
      task_no = COALESCE(snap->>'task_no', task_no),
      high_level_programme = COALESCE(snap->>'high_level_programme', high_level_programme),
      actual_start = COALESCE(snap->>'actual_start', actual_start),
      duration_days = COALESCE((snap->>'duration_days')::integer, duration_days),
      actual_end = COALESCE(snap->>'actual_end', actual_end),
      actual_pct_complete = COALESCE((snap->>'actual_pct_complete')::real, actual_pct_complete),
      expected_pct_complete = COALESCE((snap->>'expected_pct_complete')::real, expected_pct_complete),
      source = 'imported',
      import_snapshot = NULL,
      last_edited_by = NULL,
      last_edited_at = NULL
    WHERE id = r.id;
  END LOOP;
END $$;

-- Step 7: Drop indexes
DROP INDEX IF EXISTS idx_program_expense_source;
DROP INDEX IF EXISTS idx_program_inflows_source;
DROP INDEX IF EXISTS idx_cashflow_points_source;
DROP INDEX IF EXISTS idx_finance_revenue_monthly_source;
DROP INDEX IF EXISTS idx_finance_cos_monthly_source;
DROP INDEX IF EXISTS idx_project_plan_source;

-- Step 8: Drop new columns from base tables
ALTER TABLE program_expense DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;
ALTER TABLE program_inflows DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;
ALTER TABLE cashflow_points DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;
ALTER TABLE finance_revenue_monthly DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;
ALTER TABLE finance_cos_monthly DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;
ALTER TABLE project_plan DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS import_snapshot, DROP COLUMN IF EXISTS last_edited_by, DROP COLUMN IF EXISTS last_edited_at;

-- Step 9: Drop tracking tables
DROP TABLE IF EXISTS override_migration_orphans CASCADE;
DROP TABLE IF EXISTS override_migration_ambiguous CASCADE;

-- Step 10: Drop enum
DROP TYPE IF EXISTS row_source;

-- Step 11: Remove deprecation comments
COMMENT ON TABLE expenditure_overrides IS NULL;
COMMENT ON TABLE revenue_tracking_overrides IS NULL;
COMMENT ON TABLE cashflow_planning_overrides IS NULL;
COMMENT ON TABLE cos_status_overrides IS NULL;
COMMENT ON TABLE finance_revenue_overrides IS NULL;
COMMENT ON TABLE finance_cos_overrides IS NULL;
COMMENT ON TABLE project_plan_overrides IS NULL;
