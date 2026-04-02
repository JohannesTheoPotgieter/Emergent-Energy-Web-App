-- Backfill 04: Lifecycle Parity Columns
-- Updates core.projects lifecycle fields from public.project_execution_state
-- Idempotent: overwrites with latest legacy values (safe to re-run)
-- Must run AFTER: 20260402_lifecycle_parity_columns.sql
BEGIN;

UPDATE core.projects cp
SET
  current_stage_code = pes.current_stage_code,
  gate_status = pes.gate_status,
  gate_readiness_pct = pes.gate_readiness_pct,
  phase_updated_at = pes.phase_updated_at,
  signed_status = pes.signed_status,
  execution_phase = pes.execution_phase
FROM public.project_execution_state pes
WHERE cp.legacy_project_info_id = pes.project_id
  AND pes.deleted_at IS NULL;

COMMIT;
