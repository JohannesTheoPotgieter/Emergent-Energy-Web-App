-- Finance trust/performance hardening indexes (additive, idempotent)
-- Safe for dev + production: no drops, no rewrites, no data mutation.

CREATE INDEX IF NOT EXISTS idx_ncl_active_project_invoice_date
  ON normalized_cost_lines(project_id, invoice_date)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_ncl_active_project_paid_date
  ON normalized_cost_lines(project_id, paid_date)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_nrl_active_project_paid_date
  ON normalized_revenue_lines(project_id, paid_date)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_nrl_active_project_expected_payment_date
  ON normalized_revenue_lines(project_id, expected_payment_date)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_ncl_active_import_lineage
  ON normalized_cost_lines(import_run_id, source_sheet, source_row)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_nrl_active_import_lineage
  ON normalized_revenue_lines(import_run_id, source_sheet, source_row)
  WHERE effective_to IS NULL;
