-- Backfill 07: Finance Typed Dates + Fiscal Period Derivation + Opening Balance Classification
-- Six steps in order:
--   0a. Classify opening balance rows on cost_lines from legacy row_type
--   0b. Classify opening balance rows on revenue_lines from legacy row_type
--   1. Parse TEXT dates to typed DATE on finance.cost_lines (regex guard)
--   2. Parse TEXT dates to typed DATE on finance.revenue_lines (regex guard)
--   3. Derive fiscal_period_id on cost_lines from finance.fiscal_periods date range
--      (opening balance rows are EXCLUDED from period movement derivation)
--   4. Derive fiscal_period_id on revenue_lines from finance.fiscal_periods date range
--      (opening balance rows are EXCLUDED from period movement derivation)
-- All steps guarded with WHERE ... IS NULL for idempotency
-- Must run AFTER: backfill_01_fiscal_periods.sql, 20260402_finance_period_derivation.sql
BEGIN;

-- Step 0a: Classify opening balance rows on cost_lines
-- Rows with row_type indicating opening/brought-forward balances are flagged.
-- These must NOT be included in period movement totals.
UPDATE finance.cost_lines cl
SET
  is_opening_balance = true,
  legacy_row_type = pe.row_type
FROM public.program_expense pe
WHERE cl.legacy_program_expense_id = pe.id
  AND LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob')
  AND cl.is_opening_balance = false;

-- Also backfill legacy_row_type for all cost lines (non-opening too) for audit trail
UPDATE finance.cost_lines cl
SET legacy_row_type = pe.row_type
FROM public.program_expense pe
WHERE cl.legacy_program_expense_id = pe.id
  AND cl.legacy_row_type IS NULL;

-- Step 0b: Classify opening balance rows on revenue_lines
-- Revenue lines from program_inflows don't have row_type, but we check for any
-- milestone_name patterns that indicate opening balances
UPDATE finance.revenue_lines rl
SET is_opening_balance = true
FROM public.program_inflows pi
WHERE rl.legacy_program_inflow_id = pi.id
  AND LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob')
  AND rl.is_opening_balance = false;

-- Step 1: Parse TEXT dates into typed DATE columns (cost lines)
UPDATE finance.cost_lines
SET
  invoice_date_typed = CASE WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::DATE ELSE NULL END,
  approved_date_typed = CASE WHEN approved_date ~ '^\d{4}-\d{2}-\d{2}' THEN approved_date::DATE ELSE NULL END,
  paid_date_typed = CASE WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}' THEN paid_date::DATE ELSE NULL END
WHERE invoice_date_typed IS NULL;

-- Step 2: Parse TEXT dates into typed DATE columns (revenue lines)
UPDATE finance.revenue_lines
SET
  invoice_date_typed = CASE WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::DATE ELSE NULL END,
  expected_payment_date_typed = CASE WHEN expected_payment_date ~ '^\d{4}-\d{2}-\d{2}' THEN expected_payment_date::DATE ELSE NULL END,
  paid_date_typed = CASE WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}' THEN paid_date::DATE ELSE NULL END
WHERE invoice_date_typed IS NULL;

-- Step 3: Derive fiscal_period_id from invoice_date_typed (cost lines)
-- CRITICAL: Exclude opening balance rows from fiscal period derivation.
-- Opening balances are balance-forward records and must not be counted as period movement.
UPDATE finance.cost_lines cl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE cl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND cl.fiscal_period_id IS NULL
  AND cl.is_opening_balance = false;

-- Step 4: Derive fiscal_period_id from invoice_date_typed (revenue lines)
-- CRITICAL: Exclude opening balance rows from fiscal period derivation.
UPDATE finance.revenue_lines rl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE rl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND rl.fiscal_period_id IS NULL
  AND rl.is_opening_balance = false;

COMMIT;
