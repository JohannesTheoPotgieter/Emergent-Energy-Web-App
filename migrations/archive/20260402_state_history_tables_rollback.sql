-- Rollback: 20260402_state_history_tables_rollback.sql
-- WARNING: Destroys all history snapshots. Only run if history tables must be physically removed.
BEGIN;

DROP INDEX IF EXISTS finance.idx_revenue_line_history_line_current;
DROP TABLE IF EXISTS finance.revenue_line_history;

DROP INDEX IF EXISTS finance.idx_cost_line_history_line_current;
DROP TABLE IF EXISTS finance.cost_line_history;

DROP INDEX IF EXISTS documentation.idx_approval_state_history_approval_current;
DROP INDEX IF EXISTS documentation.idx_approval_state_history_legacy_id;
DROP TABLE IF EXISTS documentation.approval_state_history;

DROP INDEX IF EXISTS core.idx_project_state_history_project_current;
DROP INDEX IF EXISTS core.idx_project_state_history_project_timeline;
DROP TABLE IF EXISTS core.project_state_history;

COMMIT;
