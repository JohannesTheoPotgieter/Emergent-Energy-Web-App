-- Rollback for 20260413_integrations_registry.sql
-- Drops the integration registry + run events tables.
-- WARNING: data loss. All integration health history is gone after this runs.

BEGIN;

DROP INDEX IF EXISTS idx_integration_run_events_int_success;
DROP INDEX IF EXISTS idx_integration_run_events_int_started;
DROP TABLE IF EXISTS integration_run_events;

DROP INDEX IF EXISTS idx_integrations_name_active;
DROP TABLE IF EXISTS integrations;

COMMIT;
