-- Rollback: 20260403_c01_create_work_packages_rollback.sql
-- Reverses Phase C.1: drops work_packages.
BEGIN;

DROP TABLE IF EXISTS core.work_packages;

COMMIT;
