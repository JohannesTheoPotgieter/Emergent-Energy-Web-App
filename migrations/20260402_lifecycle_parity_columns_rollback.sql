-- Rollback: 20260402_lifecycle_parity_columns_rollback.sql
-- WARNING: Destroys all backfilled data in these columns. Only run if operational rollback is insufficient.
BEGIN;
ALTER TABLE core.projects DROP COLUMN IF EXISTS current_stage_code;
ALTER TABLE core.projects DROP COLUMN IF EXISTS gate_status;
ALTER TABLE core.projects DROP COLUMN IF EXISTS gate_readiness_pct;
ALTER TABLE core.projects DROP COLUMN IF EXISTS phase_updated_at;
ALTER TABLE core.projects DROP COLUMN IF EXISTS signed_status;
ALTER TABLE core.projects DROP COLUMN IF EXISTS execution_phase;
COMMIT;
