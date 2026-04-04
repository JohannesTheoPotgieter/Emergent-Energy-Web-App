-- Rollback: 20260403_e07_rollback_approvals.sql
-- Reverses Phase E approvals: drops instances then rules (FK order).
BEGIN;

DROP TABLE IF EXISTS core.approval_instances;
DROP TABLE IF EXISTS core.approval_rules;

COMMIT;
