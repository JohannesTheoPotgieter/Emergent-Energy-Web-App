-- Backfill 07 (PROD PATCH): Finance Typed Dates + Fiscal Period Derivation + Opening Balance Classification
-- PATCH: Uses a safe date casting function to handle invalid dates like 2026-04-31
BEGIN;

-- Create a safe date casting helper (idempotent)
CREATE OR REPLACE FUNCTION pg_temp.safe_date(val TEXT) RETURNS DATE AS $$
BEGIN
  IF val IS NULL OR val = '' THEN RETURN NULL; END IF;
  IF val !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN val::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 0a: Classify opening balance rows on cost_lines
UPDATE finance.cost_lines cl
SET
  is_opening_balance = true,
  legacy_row_type = pe.row_type
FROM public.program_expense pe
WHERE cl.legacy_program_expense_id = pe.id
  AND LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob')
  AND cl.is_opening_balance = false;

-- Backfill legacy_row_type for all cost lines
UPDATE finance.cost_lines cl
SET legacy_row_type = pe.row_type
FROM public.program_expense pe
WHERE cl.legacy_program_expense_id = pe.id
  AND cl.legacy_row_type IS NULL;

-- Step 0b: Classify opening balance rows on revenue_lines
UPDATE finance.revenue_lines rl
SET is_opening_balance = true
FROM public.program_inflows pi
WHERE rl.legacy_program_inflow_id = pi.id
  AND LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob')
  AND rl.is_opening_balance = false;

-- Step 0c: AUDIT REPORT
SELECT 'OPENING_BALANCE_AUDIT_COST_LINES' AS report_type,
       cl.id, cl.project_id, cl.project_name_snapshot, cl.legacy_row_type,
       cl.amount_ex_vat, cl.invoice_date, cl.description, cl.counterparty_name
FROM finance.cost_lines cl
WHERE cl.is_opening_balance = true
ORDER BY cl.project_id, cl.id;

SELECT 'OPENING_BALANCE_AUDIT_REVENUE_LINES' AS report_type,
       rl.id, rl.project_id, rl.project_name_snapshot,
       rl.amount_ex_vat, rl.invoice_date, rl.milestone_name
FROM finance.revenue_lines rl
WHERE rl.is_opening_balance = true
ORDER BY rl.project_id, rl.id;

-- Step 1: Parse TEXT dates into typed DATE columns (cost lines) — using safe_date
UPDATE finance.cost_lines
SET
  invoice_date_typed = pg_temp.safe_date(invoice_date),
  approved_date_typed = pg_temp.safe_date(approved_date),
  paid_date_typed = pg_temp.safe_date(paid_date)
WHERE invoice_date_typed IS NULL;

-- Step 2: Parse TEXT dates into typed DATE columns (revenue lines) — using safe_date
UPDATE finance.revenue_lines
SET
  invoice_date_typed = pg_temp.safe_date(invoice_date),
  expected_payment_date_typed = pg_temp.safe_date(expected_payment_date),
  paid_date_typed = pg_temp.safe_date(paid_date)
WHERE invoice_date_typed IS NULL;

-- Step 3: Derive fiscal_period_id from invoice_date_typed (cost lines)
UPDATE finance.cost_lines cl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE cl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND cl.fiscal_period_id IS NULL
  AND cl.is_opening_balance = false;

-- Step 4: Derive fiscal_period_id from invoice_date_typed (revenue lines)
UPDATE finance.revenue_lines rl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE rl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND rl.fiscal_period_id IS NULL
  AND rl.is_opening_balance = false;

COMMIT;
