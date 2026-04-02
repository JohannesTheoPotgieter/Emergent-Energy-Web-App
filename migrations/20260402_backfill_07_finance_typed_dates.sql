-- Backfill 07: Finance Typed Dates + Fiscal Period Derivation
-- Four steps in order:
--   1. Parse TEXT dates to typed DATE on finance.cost_lines (regex guard)
--   2. Parse TEXT dates to typed DATE on finance.revenue_lines (regex guard)
--   3. Derive fiscal_period_id on cost_lines from finance.fiscal_periods date range
--   4. Derive fiscal_period_id on revenue_lines from finance.fiscal_periods date range
-- All steps guarded with WHERE ... IS NULL for idempotency
-- Must run AFTER: backfill_01_fiscal_periods.sql, 20260402_finance_period_derivation.sql
BEGIN;

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
UPDATE finance.cost_lines cl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE cl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND cl.fiscal_period_id IS NULL;

-- Step 4: Derive fiscal_period_id from invoice_date_typed (revenue lines)
UPDATE finance.revenue_lines rl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE rl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND rl.fiscal_period_id IS NULL;

COMMIT;
