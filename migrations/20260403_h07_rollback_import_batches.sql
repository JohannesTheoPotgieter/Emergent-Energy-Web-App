-- Rollback: 20260403_h07_rollback_import_batches.sql
-- Drops Phase H import_batches.
BEGIN;

DROP TABLE IF EXISTS core.import_batches;

COMMIT;
