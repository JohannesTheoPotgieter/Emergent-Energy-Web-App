-- =========================================================================
-- TF-3 from audit/FINANCE_AUDIT_V3_2026-05-26.md — Missing composite
-- indexes on the finance hot path.
--
-- Every finance aggregate filters on (project_id, effective_to). The
-- existing partial indexes (row_hash_active_idx) help the row-hash dedup
-- path but don't cover the project_id + effective_to predicate together.
-- This adds the missing composites.
--
-- Additionally adds (paid_date, effective_to) on normalized_revenue_lines
-- to support the AR-aging hot path used by /api/finance/analysis/cashflow/
-- aging and the overdue receivables banner.
--
-- All additive. CONCURRENTLY would be nicer but isn't available inside a
-- migration transaction; the indexes are small enough that this is OK in
-- a maintenance window. NOT applied automatically — needs `npm run
-- db:migrate` approval per § 6 of docs/AGENT_GUARDRAILS.md.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project_effective
  ON normalized_cost_lines (project_id, effective_to);

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_project_effective
  ON normalized_revenue_lines (project_id, effective_to);

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_paid_effective
  ON normalized_revenue_lines (paid_date, effective_to);
