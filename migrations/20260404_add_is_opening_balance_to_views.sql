-- Add is_opening_balance to view-swap views and legacy tables
--
-- The is_opening_balance column already exists on finance.cost_lines and
-- finance.revenue_lines (from 20260402_finance_period_derivation.sql), but
-- it is not projected through the normalized_cost_lines / normalized_revenue_lines
-- views created by the view-swap migrations.
--
-- This migration:
--   1. Adds the column to the legacy backup tables
--   2. Backfills from the promoted tables
--   3. Recreates the views to include the column

BEGIN;

-- ============================================================================
-- 1. Add column to legacy backup tables
-- ============================================================================

ALTER TABLE public._normalized_cost_lines_legacy
  ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN DEFAULT false;

ALTER TABLE public._normalized_revenue_lines_legacy
  ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN DEFAULT false;

-- ============================================================================
-- 2. Backfill legacy tables from promoted (where is_opening_balance = true)
-- ============================================================================

UPDATE public._normalized_cost_lines_legacy ncl
SET is_opening_balance = true
FROM finance.cost_lines cl
WHERE cl.legacy_normalized_cost_line_id = ncl.id
  AND cl.is_opening_balance = true;

UPDATE public._normalized_revenue_lines_legacy nrl
SET is_opening_balance = true
FROM finance.revenue_lines rl
WHERE rl.legacy_normalized_revenue_line_id = nrl.id
  AND rl.is_opening_balance = true;

-- ============================================================================
-- 3. Recreate normalized_cost_lines view with is_opening_balance
-- ============================================================================

CREATE OR REPLACE VIEW public.normalized_cost_lines AS
SELECT
  cl.legacy_normalized_cost_line_id AS id,
  COALESCE(cl.project_id, 0) AS project_id,
  COALESCE(cl.project_name_snapshot, '') AS project_name,
  cl.cost_category,
  cl.counterparty_id,
  cl.counterparty_name,
  cl.counterparty_type,
  cl.description,
  cl.amount_ex_vat,
  cl.amount_ex_vat_legacy,
  cl.invoice_number,
  cl.invoice_date,
  cl.invoice_date_font_color,
  cl.invoice_date_confirmed,
  cl.approved_date,
  cl.paid_date,
  cl.paid_date_font_color,
  cl.paid_date_confirmed,
  cl.po_number,
  cl.cos_realised,
  cl.cashflow_confirmed,
  cl.cost_line_status,
  cl.source_sheet,
  cl.source_row,
  cl.import_run_id,
  cl.turnaround_days,
  cl.pattern_rule_id,
  cl.pattern_classified_at,
  cl.pattern_inferred_type,
  cl.no_revenue_linked,
  cl.budget_qty,
  cl.budget_rate,
  cl.budget_total,
  cl.budget_cos,
  cl.revenue_recognition_amount,
  cl.forecast_payment_date,
  cl.admin_date_override,
  cl.admin_date_override_reason,
  cl.admin_date_override_by,
  cl.admin_date_override_at,
  cl.sub_project_name,
  cl.cos_status_override,
  cl.cos_status_override_by,
  cl.cos_status_override_at,
  cl.cos_status_override_reason,
  cl.is_opening_balance,
  cl.created_at,
  cl.updated_at,
  cl.effective_from,
  cl.effective_to,
  cl.snapshot_run_id
FROM finance.cost_lines cl
WHERE cl.legacy_normalized_cost_line_id IS NOT NULL;

-- ============================================================================
-- 4. Recreate normalized_revenue_lines view with is_opening_balance
-- ============================================================================

CREATE OR REPLACE VIEW public.normalized_revenue_lines AS
SELECT
  rl.legacy_normalized_revenue_line_id AS id,
  COALESCE(rl.project_id, 0) AS project_id,
  COALESCE(rl.project_name_snapshot, '') AS project_name,
  rl.description,
  rl.milestone_name,
  rl.amount_ex_vat,
  rl.vat,
  rl.amount_ex_vat_legacy,
  rl.vat_legacy,
  rl.invoice_number,
  rl.invoice_date,
  rl.invoice_date_font_color,
  rl.invoice_date_confirmed,
  rl.expected_payment_date,
  rl.paid_date,
  rl.paid_date_font_color,
  rl.paid_date_confirmed,
  rl.in_bank_date,
  rl.status,
  rl.source_sheet,
  rl.source_row,
  rl.import_run_id,
  rl.turnaround_days,
  rl.admin_date_override,
  rl.admin_date_override_reason,
  rl.admin_date_override_by,
  rl.admin_date_override_at,
  rl.sub_project_name,
  rl.is_opening_balance,
  rl.created_at,
  rl.updated_at,
  rl.effective_from,
  rl.effective_to,
  rl.snapshot_run_id
FROM finance.revenue_lines rl
WHERE rl.legacy_normalized_revenue_line_id IS NOT NULL;

COMMIT;
