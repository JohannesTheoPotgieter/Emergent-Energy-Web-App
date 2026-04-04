-- Rollback: 20260403_h06_rollback_views.sql
-- Drops Phase H compatibility views.
BEGIN;

DROP VIEW IF EXISTS core.v_governed_processes;
DROP VIEW IF EXISTS core.v_approvals;
DROP VIEW IF EXISTS core.v_deliverables;
DROP VIEW IF EXISTS finance.v_finance_records;
DROP VIEW IF EXISTS core.v_work_items;
DROP VIEW IF EXISTS core.v_projects;

COMMIT;
