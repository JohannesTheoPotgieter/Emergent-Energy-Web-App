-- Rollback: 20260403_f08_rollback_budget_lines.sql
-- Reverses Phase F budget_lines.
BEGIN;

DROP TABLE IF EXISTS finance.budget_lines;

COMMIT;
