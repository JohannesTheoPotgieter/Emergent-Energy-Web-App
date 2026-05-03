-- Rollback for 20260412_cos_period_locks.sql
-- Drops the cos_period_locks table and its indexes.
-- WARNING: data loss. Historical lock audit trail is gone after this runs.

BEGIN;

DROP INDEX IF EXISTS idx_cos_period_locks_active;
DROP INDEX IF EXISTS idx_cos_period_locks_period;
DROP TABLE IF EXISTS cos_period_locks;

COMMIT;
