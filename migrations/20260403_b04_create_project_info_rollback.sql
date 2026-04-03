-- Rollback: 20260403_b04_create_project_info_rollback.sql
-- Reverses Phase B.3: drops parameter_values then project_info (FK order).
-- Safe: no app code reads from these tables; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.project_info_parameter_values;
DROP TABLE IF EXISTS core.project_info;

COMMIT;
