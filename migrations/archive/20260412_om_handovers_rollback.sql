-- Rollback for 20260412_om_handovers.sql
-- Drops the om_handovers table and its indexes.
-- WARNING: data loss. All O&M handover audit data is gone after this runs.

BEGIN;

DROP INDEX IF EXISTS idx_om_handovers_status;
DROP INDEX IF EXISTS idx_om_handovers_planned_date;
DROP INDEX IF EXISTS uq_om_handovers_project_active;
DROP TABLE IF EXISTS om_handovers;

COMMIT;
