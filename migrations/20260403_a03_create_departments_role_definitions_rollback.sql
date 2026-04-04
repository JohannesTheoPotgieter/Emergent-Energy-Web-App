-- Rollback: 20260403_a03_create_departments_role_definitions_rollback.sql
-- Reverses Phase A.1: drops core.role_definitions then core.departments.
-- Safe: no app code reads from these tables; no downstream FK dependencies yet.
-- Must drop role_definitions first (it has FK to departments).
BEGIN;

DROP TABLE IF EXISTS core.role_definitions;
DROP TABLE IF EXISTS core.departments;

COMMIT;
