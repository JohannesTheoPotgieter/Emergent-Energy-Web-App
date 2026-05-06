-- Rollback for 20260412_stage_gate_evidence_snapshots.sql
--
-- Drops the stage_gate_evidence_snapshots table and its indexes.
-- WARNING: data loss. Historical audit trail is gone after this runs.

BEGIN;

DROP INDEX IF EXISTS sges_traffic_light_idx;
DROP INDEX IF EXISTS sges_from_stage_idx;
DROP INDEX IF EXISTS sges_advanced_at_idx;
DROP INDEX IF EXISTS sges_project_id_idx;
DROP TABLE IF EXISTS stage_gate_evidence_snapshots;

COMMIT;
