-- =============================================================================
-- Migration: Performance indexes on normalized financial tables
-- Date: 2026-04-15
-- Risk: LOW — additive only, no data/structure mutation.
--
-- Context:
--   Every financial report/dashboard query hits normalized_cost_lines and
--   normalized_revenue_lines. Several single-column and composite indexes
--   already exist (project_id FKs, counterparty_id, import_run_id, and
--   partial (project_id, invoice_date)/(project_id, paid_date) indexes
--   scoped to `WHERE effective_to IS NULL`). This migration fills the
--   remaining gaps flagged by the query-plan review:
--
--     1. Standalone `invoice_date` indexes on both normalized line tables.
--        Reports that pivot by month across all projects (or that query
--        without a project filter) cannot use the existing composite
--        partial indexes — they need a leading invoice_date column.
--
--     2. Non-partial `(project_id, invoice_date)` composites. The existing
--        partial indexes only cover active temporal rows; historical/
--        temporal snapshot reads that scan closed rows bypass the partial
--        index. The non-partial version adds a small storage cost and
--        restores index coverage for those queries.
--
--     3. `derived_project_kpis.project_id` — the table has a FK constraint
--        but Postgres does not auto-create an index for FKs. Dashboard
--        joins (see server/services/canonical-dashboard-kpi-service.ts
--        and the company_priorities view) all filter/join on project_id.
--
-- Skipped (already exist — verified against the migrations directory):
--   - idx_normalized_cost_lines_project_id     (20260414_safe_parity_normalized_line_indexes.sql)
--   - idx_normalized_cost_lines_counterparty_id (20260340_schema_consistency_fixes.sql)
--   - idx_normalized_revenue_lines_project_id  (20260414_safe_parity_normalized_line_indexes.sql)
--   - idx_ncl_active_project_invoice_date      (20260414_finance_trust_performance_indexes.sql, partial)
--   - idx_ncl_active_project_paid_date         (20260414_finance_trust_performance_indexes.sql, partial)
--   - idx_nrl_active_project_paid_date         (20260414_finance_trust_performance_indexes.sql, partial)
--   - idx_nrl_active_project_expected_payment_date (20260414_finance_trust_performance_indexes.sql, partial)
--   - idx_ncl_import_run_id / idx_nrl_import_run_id (20260331_add_missing_fk_indexes.sql)
--   - idx_ncl_project_snapshot / idx_nrl_project_snapshot (20260331_add_missing_fk_indexes.sql)
--   - idx_dpm_project_id on dashboard_project_metrics (20260335_dashboard_materialized_metrics.sql)
--
-- Notes:
--   - normalized_revenue_lines has NO counterparty_id column, so the
--     counterparty_id index requested by the task is only added for the
--     cost line table (which already has it — see Skipped above).
--   - `invoice_date` is the canonical "primary date" column for both
--     normalized line tables; there is no `date`, `period`, or `month`
--     column to index.
--   - Idempotent via `IF NOT EXISTS`. Rollback: drop the four new indexes.
--   - The migration runner does not wrap statements in a transaction, so
--     each CREATE INDEX runs independently. Following the established
--     pattern in 20260331_add_missing_fk_indexes.sql, we use plain
--     CREATE INDEX (not CONCURRENTLY) for consistency with existing
--     migrations. For very large tables in production, DBAs may re-run
--     these as `CREATE INDEX CONCURRENTLY` manually; the IF NOT EXISTS
--     guard makes that safe.
-- =============================================================================

-- ─── Standalone invoice_date indexes ────────────────────────────────────────

-- Supports date-only queries (e.g. cross-project monthly aggregates, cashflow
-- time-series reports that don't scope by project).
CREATE INDEX IF NOT EXISTS idx_ncl_invoice_date
  ON normalized_cost_lines (invoice_date);

CREATE INDEX IF NOT EXISTS idx_nrl_invoice_date
  ON normalized_revenue_lines (invoice_date);

-- ─── Non-partial composite (project_id, invoice_date) indexes ──────────────

-- Covers historical/temporal queries that cannot use the existing
-- `WHERE effective_to IS NULL` partial indexes. Project financial timelines
-- and month-over-month drilldowns benefit from the composite leading with
-- project_id.
CREATE INDEX IF NOT EXISTS idx_ncl_project_invoice_date
  ON normalized_cost_lines (project_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_nrl_project_invoice_date
  ON normalized_revenue_lines (project_id, invoice_date);

-- ─── Derived KPI dashboard table ────────────────────────────────────────────

-- derived_project_kpis has a FK on project_id but no backing index. Every
-- dashboard join pulls by project_id (see canonical-dashboard-kpi-service.ts
-- and the company_priorities_overview view).
CREATE INDEX IF NOT EXISTS idx_derived_project_kpis_project_id
  ON derived_project_kpis (project_id);
