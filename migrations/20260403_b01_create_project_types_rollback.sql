-- Rollback: 20260403_b01_create_project_types_rollback.sql
-- Reverses Phase B.1: drops parameter_definitions then project_types (FK order).
-- Safe: no app code reads from these tables; no downstream FK dependencies yet.
BEGIN;

DROP TABLE IF EXISTS core.project_type_parameter_definitions;
DROP TABLE IF EXISTS core.project_types;

COMMIT;
