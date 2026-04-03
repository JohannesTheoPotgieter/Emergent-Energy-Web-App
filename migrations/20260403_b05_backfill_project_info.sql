-- Backfill: 20260403_b05_backfill_project_info.sql
-- Phase B.3: Create one core.project_info row per project_instance.
-- project_type_id is NULL (assigned via frontend once types are mapped).
-- parameter_values left empty (populated once admins define parameters via frontend).
-- Idempotent: ON CONFLICT (project_instance_id) DO NOTHING.
-- Must run AFTER: 20260403_b04_create_project_info.sql
BEGIN;

INSERT INTO core.project_info (project_instance_id, project_type_id)
SELECT
  pi.id,
  pi.project_type_id
FROM core.project_instances pi
ON CONFLICT (project_instance_id) DO NOTHING;

COMMIT;
