-- Backfill 01: Fiscal Periods
-- Replicates public.fiscal_periods + public.fiscal_years into finance.fiscal_periods
-- Idempotent via ON CONFLICT (legacy_fiscal_period_id) DO NOTHING
-- Must run AFTER: 20260402_finance_period_derivation.sql
BEGIN;

INSERT INTO finance.fiscal_periods (
  legacy_fiscal_period_id, fiscal_year_name, period_name, start_date, end_date, sort_order, source_table
)
SELECT
  fp.id,
  fy.name,
  fp.period_name,
  fp.start_date,
  fp.end_date,
  fp.sort_order,
  'public.fiscal_periods'
FROM public.fiscal_periods fp
JOIN public.fiscal_years fy ON fy.id = fp.fiscal_year_id
ON CONFLICT (legacy_fiscal_period_id) DO NOTHING;

COMMIT;
