-- Rollback: 20260403_b02_create_project_instances_rollback.sql
-- Reverses Phase B.2: drops core.project_instances table.
-- Safe: no app code reads from core.project_instances; no downstream FK dependencies yet.
BEGIN;

DROP TABLE IF EXISTS core.project_instances;

COMMIT;
