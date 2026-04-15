-- Rollback for 20260415_financial_tables_performance_indexes.sql
-- Drops only the indexes introduced by that migration. Safe and idempotent.
-- No data/structure changes.

DROP INDEX IF EXISTS idx_ncl_invoice_date;
DROP INDEX IF EXISTS idx_nrl_invoice_date;
DROP INDEX IF EXISTS idx_ncl_project_invoice_date;
DROP INDEX IF EXISTS idx_nrl_project_invoice_date;
DROP INDEX IF EXISTS idx_derived_project_kpis_project_id;
