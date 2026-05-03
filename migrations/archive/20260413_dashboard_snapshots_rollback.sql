-- Rollback for 20260413_dashboard_snapshots.sql
-- Drops the dashboard snapshot cache table.
-- WARNING: cache-only data, next refresh will rebuild it.

BEGIN;

DROP INDEX IF EXISTS idx_dashboard_snapshots_key_computed;
DROP INDEX IF EXISTS uq_dashboard_snapshots_key;
DROP TABLE IF EXISTS dashboard_snapshots;

COMMIT;
