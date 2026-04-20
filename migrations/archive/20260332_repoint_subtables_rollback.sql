-- ============================================================
-- Rollback: Prompt 7 — Repoint Task Sub-tables
--
-- Removes work_item_id from sub-tables.
-- The old task_id columns remain intact — no data loss.
-- ============================================================

ALTER TABLE task_comments DROP COLUMN IF EXISTS work_item_id;
ALTER TABLE task_checklists DROP COLUMN IF EXISTS work_item_id;
ALTER TABLE task_attachments DROP COLUMN IF EXISTS work_item_id;
ALTER TABLE task_activity_log DROP COLUMN IF EXISTS work_item_id;
ALTER TABLE task_watchers DROP COLUMN IF EXISTS work_item_id;
ALTER TABLE task_deliverables DROP COLUMN IF EXISTS work_item_id;
