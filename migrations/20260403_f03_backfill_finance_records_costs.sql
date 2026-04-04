-- Backfill: 20260403_f03_backfill_finance_records_costs.sql
-- Phase F.3: Populate finance.finance_records from finance.cost_lines (promoted spine).
-- Each cost_line becomes a finance_record with direction='outflow'.
-- financial_type derived from source_table context.
-- Idempotent: ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING.
-- Must run AFTER: 20260403_f01_create_finance_records.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_projects  INTEGER;
  _opening_balances    INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_projects
  FROM finance.cost_lines cl
  WHERE cl.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.project_instances pi
      WHERE pi.legacy_project_id = cl.project_id
    );
  IF _unmatched_projects > 0 THEN
    RAISE WARNING '[Phase F.3 backfill] % cost_line(s) have a project_id not resolvable to project_instances', _unmatched_projects;
  END IF;

  SELECT COUNT(*) INTO _opening_balances
  FROM finance.cost_lines cl
  WHERE cl.is_opening_balance = true;
  IF _opening_balances > 0 THEN
    RAISE WARNING '[Phase F.3 backfill] % cost_line(s) flagged as opening balances will be included with is_opening_balance in record_data', _opening_balances;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Insert cost_lines as outflow finance_records
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, status,
  fiscal_period_id, import_source,
  record_data, created_at, updated_at
)
SELECT
  cl.id,
  'cost_lines',
  pi.id,
  CASE
    WHEN cl.source_table = 'program_expense' THEN 'cost'
    WHEN cl.source_table = 'normalized_cost_lines' THEN 'cost'
    ELSE 'cost'
  END,
  'outflow',
  cl.description,
  cl.amount_ex_vat,
  COALESCE(cl.status, 'unknown'),
  cl.fiscal_period_id,
  cl.source_table,
  jsonb_build_object(
    'counterparty_name', cl.counterparty_name,
    'invoice_number', cl.invoice_number,
    'invoice_date', cl.invoice_date,
    'invoice_date_typed', cl.invoice_date_typed,
    'approved_date', cl.approved_date,
    'approved_date_typed', cl.approved_date_typed,
    'paid_date', cl.paid_date,
    'paid_date_typed', cl.paid_date_typed,
    'is_opening_balance', cl.is_opening_balance,
    'legacy_row_type', cl.legacy_row_type,
    'legacy_program_expense_id', cl.legacy_program_expense_id,
    'legacy_normalized_cost_line_id', cl.legacy_normalized_cost_line_id,
    'import_run_id', cl.import_run_id,
    'project_name_snapshot', cl.project_name_snapshot
  ),
  cl.created_at,
  cl.updated_at
FROM finance.cost_lines cl
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = cl.project_id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Resolve party_id from counterparty_name → core.parties
-- -------------------------------------------------------
UPDATE finance.finance_records fr
SET party_id = p.id
FROM finance.cost_lines cl
JOIN core.parties p ON LOWER(p.name_canonical) = LOWER(cl.counterparty_name)
  AND p.source_table = 'counterparties'
WHERE fr.legacy_entity_table = 'cost_lines'
  AND fr.legacy_entity_id = cl.id
  AND cl.counterparty_name IS NOT NULL
  AND fr.party_id IS NULL;

COMMIT;
