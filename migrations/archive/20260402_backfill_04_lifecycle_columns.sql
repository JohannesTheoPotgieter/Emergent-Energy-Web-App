-- Backfill 04: Lifecycle Parity Columns
-- Updates core.projects lifecycle fields from public.project_execution_state
-- Uses ROW_NUMBER() to select only the latest row per project_id, preventing
-- duplicate current-state rows from inflating or conflicting backfill results.
-- Idempotent: overwrites with latest legacy values (safe to re-run)
-- Must run AFTER: 20260402_lifecycle_parity_columns.sql
BEGIN;

UPDATE core.projects cp
SET
  current_stage_code = latest_pes.current_stage_code,
  gate_status = latest_pes.gate_status,
  gate_readiness_pct = latest_pes.gate_readiness_pct,
  phase_updated_at = latest_pes.phase_updated_at,
  signed_status = latest_pes.signed_status,
  execution_phase = latest_pes.execution_phase
FROM (
  SELECT *
  FROM (
    SELECT pes.*,
           ROW_NUMBER() OVER (
             PARTITION BY pes.project_id
             ORDER BY pes.updated_at DESC NULLS LAST,
                      pes.created_at DESC NULLS LAST,
                      pes.id DESC
           ) AS rn
    FROM public.project_execution_state pes
    WHERE pes.deleted_at IS NULL
  ) ranked
  WHERE ranked.rn = 1
) latest_pes
WHERE cp.legacy_project_info_id = latest_pes.project_id;

COMMIT;
