-- Migration: 20260403_b10_add_phase_definition_fk_to_project_instances.sql
-- Phase B fix: Add current_phase_definition_id FK to project_instances.
-- Now that core.phase_definitions exists (B.5), we can add the proper FK
-- that the target architecture spec requires on the project spine.
-- The existing current_phase TEXT column remains for backward compatibility.
-- Additive only. No app code changes.
BEGIN;

-- -------------------------------------------------------
-- 1. Add current_phase_definition_id column
-- -------------------------------------------------------
ALTER TABLE core.project_instances
  ADD COLUMN IF NOT EXISTS current_phase_definition_id INTEGER
  REFERENCES core.phase_definitions(id);

-- -------------------------------------------------------
-- 2. Index on the new FK
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_instances_current_phase_definition_id
  ON core.project_instances (current_phase_definition_id);

-- -------------------------------------------------------
-- 3. Backfill from core.projects.current_stage_code → phase_definitions.code
-- -------------------------------------------------------
UPDATE core.project_instances pi
SET current_phase_definition_id = pd.id
FROM core.projects p
JOIN core.phase_definitions pd ON pd.code = p.current_stage_code
WHERE pi.legacy_project_id = p.id
  AND p.current_stage_code IS NOT NULL
  AND pi.current_phase_definition_id IS NULL;

COMMIT;
