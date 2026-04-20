-- Rollback for 20260412_safety_file_items.sql
-- Drops the safety_file_items table and its indexes.
-- WARNING: data loss. All Safety File audit data is gone after this runs.

BEGIN;

DROP INDEX IF EXISTS uq_safety_file_items_project_item_active;
DROP INDEX IF EXISTS idx_safety_file_items_status;
DROP INDEX IF EXISTS idx_safety_file_items_due;
DROP INDEX IF EXISTS idx_safety_file_items_project;
DROP TABLE IF EXISTS safety_file_items;

COMMIT;
