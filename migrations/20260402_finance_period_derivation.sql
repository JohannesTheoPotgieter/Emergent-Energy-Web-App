-- Migration: 20260402_finance_period_derivation.sql
-- Phase 1B Blocker 4: Add typed date columns, fiscal_period_id, and finance.fiscal_periods table
BEGIN;

-- Add typed date columns alongside existing TEXT dates (non-breaking)
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS approved_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER;

ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS expected_payment_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER;

-- Replicate fiscal period definitions into the finance schema for self-contained queries
CREATE TABLE IF NOT EXISTS finance.fiscal_periods (
  id SERIAL PRIMARY KEY,
  legacy_fiscal_period_id INTEGER UNIQUE,
  fiscal_year_name TEXT NOT NULL,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sort_order INTEGER NOT NULL,
  source_table TEXT NOT NULL DEFAULT 'public.fiscal_periods',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_fiscal_period
  ON finance.cost_lines (fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_fiscal_period
  ON finance.revenue_lines (fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_finance_fiscal_periods_range
  ON finance.fiscal_periods (start_date, end_date);

COMMENT ON COLUMN finance.cost_lines.invoice_date_typed IS 'Typed DATE parsed from TEXT invoice_date for fiscal period derivation';
COMMENT ON COLUMN finance.cost_lines.fiscal_period_id IS 'Derived FK to finance.fiscal_periods based on invoice_date_typed';
COMMENT ON COLUMN finance.revenue_lines.invoice_date_typed IS 'Typed DATE parsed from TEXT invoice_date for fiscal period derivation';
COMMENT ON COLUMN finance.revenue_lines.fiscal_period_id IS 'Derived FK to finance.fiscal_periods based on invoice_date_typed';

COMMIT;
