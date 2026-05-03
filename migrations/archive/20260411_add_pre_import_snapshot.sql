-- S04: Add pre_import_snapshot to smart_import_runs
-- Purpose: Stores a JSON snapshot of work_items state before a v2 commit
--          overwrites them in-place. Required for state-restoring rollback.
-- Safety: Additive — single nullable JSONB column, no data changes.
-- Rollback: 20260411_add_pre_import_snapshot_rollback.sql

ALTER TABLE smart_import_runs
  ADD COLUMN IF NOT EXISTS pre_import_snapshot JSONB;
