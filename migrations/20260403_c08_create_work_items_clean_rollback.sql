-- Rollback: 20260403_c03_create_work_items_clean_rollback.sql
-- Reverses Phase C.2: drops work_items_clean.
-- Must run BEFORE c01 rollback (work_packages) since work_items_clean has FK to work_packages.
BEGIN;

DROP TABLE IF EXISTS core.work_items_clean;

COMMIT;
