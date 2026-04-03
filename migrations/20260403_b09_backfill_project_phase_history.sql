-- Backfill: 20260403_b09_backfill_project_phase_history.sql
-- Phase B.5: Populate core.project_phase_history with current phase per project.
-- Sources current_stage_code from core.projects (backfilled from project_execution_state).
-- Only records is_current=true rows. Historical transitions deferred to later slice.
-- Idempotent: WHERE NOT EXISTS guard.
-- Must run AFTER: 20260403_b08_create_phase_definitions.sql
BEGIN;

-- -------------------------------------------------------
-- Safety check: warn about unmatchable stage codes
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched
  FROM core.projects p
  WHERE p.current_stage_code IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.phase_definitions pd
      WHERE pd.code = p.current_stage_code
    );
  IF _unmatched > 0 THEN
    RAISE WARNING '[Phase B.5 backfill] % project(s) have a current_stage_code not found in core.phase_definitions', _unmatched;
  END IF;
END $$;

-- -------------------------------------------------------
-- Insert current phase per project (is_current=true)
-- -------------------------------------------------------
INSERT INTO core.project_phase_history (
  project_instance_id,
  phase_definition_id,
  entered_at,
  is_current
)
SELECT
  pi.id,
  pd.id,
  COALESCE(p.phase_updated_at, p.created_at),
  true
FROM core.projects p
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.phase_definitions pd ON pd.code = p.current_stage_code
WHERE p.current_stage_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.project_phase_history pph
    WHERE pph.project_instance_id = pi.id
      AND pph.phase_definition_id = pd.id
      AND pph.is_current = true
  );

COMMIT;
