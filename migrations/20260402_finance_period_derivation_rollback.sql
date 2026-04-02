-- Rollback: 20260402_finance_period_derivation_rollback.sql
-- WARNING: Destroys all derived typed dates and fiscal period assignments.
-- The original TEXT date columns are untouched — no data loss on source fields.
BEGIN;
DROP INDEX IF EXISTS finance.idx_finance_cost_lines_fiscal_period;
DROP INDEX IF EXISTS finance.idx_finance_revenue_lines_fiscal_period;
DROP INDEX IF EXISTS finance.idx_finance_fiscal_periods_range;

ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS invoice_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS approved_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS paid_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS fiscal_period_id;

ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS invoice_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS expected_payment_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS paid_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS fiscal_period_id;

DROP TABLE IF EXISTS finance.fiscal_periods;
COMMIT;
