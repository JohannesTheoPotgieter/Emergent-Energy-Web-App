-- Backfill: 20260403_b03_backfill_project_instances.sql
-- Phase B.2: Populate core.project_instances from core.projects + project_execution_state.
-- Resolves client_party_id via core.parties.legacy_client_id.
-- Planned dates from project_execution_state (construction_start → planned_start, client_handover → planned_end).
-- project_type_id is left NULL (no type data exists on legacy projects; set via frontend).
-- Idempotent: ON CONFLICT (legacy_project_id) DO NOTHING.
-- Must run AFTER: 20260403_b02_create_project_instances.sql
BEGIN;

INSERT INTO core.project_instances (
  legacy_project_id,
  project_code,
  project_name,
  client_party_id,
  status,
  current_phase,
  planned_start_date,
  planned_end_date,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.project_code,
  p.project_name,
  cp.id,
  CASE
    WHEN p.archived_status = 'archived' THEN 'archived'
    WHEN p.execution_gate_status = 'blocked' THEN 'blocked'
    ELSE 'active'
  END,
  p.phase,
  pes.construction_start_date,
  pes.client_handover_date,
  p.created_at,
  p.updated_at
FROM core.projects p
LEFT JOIN core.parties cp ON cp.legacy_client_id = p.client_id
LEFT JOIN project_execution_state pes ON pes.project_id = p.legacy_project_info_id
ON CONFLICT (legacy_project_id) DO NOTHING;

COMMIT;
