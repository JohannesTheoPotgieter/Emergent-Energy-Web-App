-- Backfill: 20260403_f04_backfill_finance_records_revenue.sql
-- Phase F.4: Populate finance.finance_records from finance.revenue_lines (promoted spine).
-- Each revenue_line becomes a finance_record with direction='inflow'.
-- Idempotent: ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING.
-- Must run AFTER: 20260403_f01_create_finance_records.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_projects  INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_projects
  FROM finance.revenue_lines rl
  WHERE rl.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.project_instances pi
      WHERE pi.legacy_project_id = rl.project_id
    );
  IF _unmatched_projects > 0 THEN
    RAISE WARNING '[Phase F.4 backfill] % revenue_line(s) have a project_id not resolvable to project_instances', _unmatched_projects;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Insert revenue_lines as inflow finance_records
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, status,
  fiscal_period_id, import_source,
  record_data, created_at, updated_at
)
SELECT
  rl.id,
  'revenue_lines',
  pi.id,
  'revenue',
  'inflow',
  rl.milestone_name,
  rl.amount_ex_vat,
  COALESCE(rl.status, 'unknown'),
  rl.fiscal_period_id,
  rl.source_table,
  jsonb_build_object(
    'invoice_number', rl.invoice_number,
    'invoice_date', rl.invoice_date,
    'invoice_date_typed', rl.invoice_date_typed,
    'expected_payment_date', rl.expected_payment_date,
    'expected_payment_date_typed', rl.expected_payment_date_typed,
    'paid_date', rl.paid_date,
    'paid_date_typed', rl.paid_date_typed,
    'is_opening_balance', rl.is_opening_balance,
    'legacy_row_type', rl.legacy_row_type,
    'legacy_program_inflow_id', rl.legacy_program_inflow_id,
    'legacy_normalized_revenue_line_id', rl.legacy_normalized_revenue_line_id,
    'import_run_id', rl.import_run_id,
    'project_name_snapshot', rl.project_name_snapshot
  ),
  rl.created_at,
  rl.updated_at
FROM finance.revenue_lines rl
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = rl.project_id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

COMMIT;
