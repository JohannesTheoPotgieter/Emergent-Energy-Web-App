-- Rollback: 20260403_b10_add_phase_definition_fk_to_project_instances_rollback.sql
-- Reverses the current_phase_definition_id FK addition on project_instances.
BEGIN;

DROP INDEX IF EXISTS core.idx_project_instances_current_phase_definition_id;

ALTER TABLE core.project_instances
  DROP COLUMN IF EXISTS current_phase_definition_id;

COMMIT;
