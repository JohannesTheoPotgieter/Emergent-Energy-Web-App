-- Migration: 20260402_lifecycle_parity_columns.sql
-- Phase 1B Blocker 1: Add lifecycle parity columns to core.projects
-- Additive only. All nullable, no defaults.
BEGIN;

ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS current_stage_code TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS gate_status TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS gate_readiness_pct NUMERIC(5,2);
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMP;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS signed_status TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS execution_phase TEXT;

COMMENT ON COLUMN core.projects.current_stage_code IS 'Mirrors project_execution_state.current_stage_code (S01-S10)';
COMMENT ON COLUMN core.projects.gate_status IS 'Mirrors project_execution_state.gate_status (NOT_STARTED/IN_PROGRESS/READY_FOR_REVIEW/APPROVED/etc)';
COMMENT ON COLUMN core.projects.gate_readiness_pct IS 'Mirrors project_execution_state.gate_readiness_pct (0.00-100.00)';
COMMENT ON COLUMN core.projects.phase_updated_at IS 'Mirrors project_execution_state.phase_updated_at for temporal ordering';
COMMENT ON COLUMN core.projects.signed_status IS 'Mirrors project_execution_state.signed_status';
COMMENT ON COLUMN core.projects.execution_phase IS 'Mirrors project_execution_state.execution_phase';

COMMIT;
