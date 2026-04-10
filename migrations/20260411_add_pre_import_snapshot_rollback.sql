-- Rollback for S04: Remove pre_import_snapshot from smart_import_runs
-- Safety: Only drops the column created by the forward migration.

ALTER TABLE smart_import_runs
  DROP COLUMN IF EXISTS pre_import_snapshot;
