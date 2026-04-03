-- Rollback: 20260403_a08_create_role_assignments_rollback.sql
-- Reverses Phase A.4: drops core.role_assignments table.
-- Safe: no app code reads from core.role_assignments; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.role_assignments;

COMMIT;
