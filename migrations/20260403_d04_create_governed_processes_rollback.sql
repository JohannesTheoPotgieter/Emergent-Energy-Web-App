-- Rollback: 20260403_d04_create_governed_processes_rollback.sql
-- Reverses Phase D: drops checklist_items then governed_processes (FK order).
BEGIN;

DROP TABLE IF EXISTS core.governed_process_checklist_items;
DROP TABLE IF EXISTS core.governed_processes;

COMMIT;
