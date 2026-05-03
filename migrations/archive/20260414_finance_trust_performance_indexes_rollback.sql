-- Rollback for 20260414_finance_trust_performance_indexes.sql

DROP INDEX IF EXISTS idx_ncl_active_project_invoice_date;
DROP INDEX IF EXISTS idx_ncl_active_project_paid_date;
DROP INDEX IF EXISTS idx_nrl_active_project_paid_date;
DROP INDEX IF EXISTS idx_nrl_active_project_expected_payment_date;
DROP INDEX IF EXISTS idx_ncl_active_import_lineage;
DROP INDEX IF EXISTS idx_nrl_active_import_lineage;
