-- Rollback: 20260403_b08_create_phase_definitions_rollback.sql
-- Reverses Phase B.5: drops project_phase_history then phase_definitions (FK order).
-- Safe: no app code reads from these tables; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.project_phase_history;
DROP TABLE IF EXISTS core.phase_definitions;

COMMIT;
