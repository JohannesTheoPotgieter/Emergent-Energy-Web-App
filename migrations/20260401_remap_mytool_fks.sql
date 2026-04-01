-- Phase 6: Remap FK references off mytool_tasks, archive, and prepare for drop
--
-- Prerequisites verified by live DB parity check (Phase 4):
-- - mytool_tasks has 0 active rows
-- - mytool_recurrence_instances has 0 orphan records
-- - mytool_timeblocks has 0 orphan linkedTaskId references
-- - mytool_email_links has 0 orphan linkedTaskId references

-- ============================================================
-- Step 1: Archive mytool_recurrence_instances (0 orphans, zero runtime usage)
-- ============================================================
CREATE TABLE IF NOT EXISTS _archive_mytool_recurrence_instances AS
  SELECT * FROM mytool_recurrence_instances;
DROP TABLE IF EXISTS mytool_recurrence_instances CASCADE;

-- ============================================================
-- Step 2: Remap mytool_timeblocks.linked_task_id FK from mytool_tasks → work_items
-- ============================================================
-- Drop the old FK constraint (name may vary; use IF EXISTS pattern)
DO $$ BEGIN
  ALTER TABLE mytool_timeblocks DROP CONSTRAINT IF EXISTS mytool_timeblocks_linked_task_id_mytool_tasks_id_fk;
  ALTER TABLE mytool_timeblocks DROP CONSTRAINT IF EXISTS mytool_timeblocks_linked_task_id_fkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
-- Add new FK to work_items
ALTER TABLE mytool_timeblocks
  ADD CONSTRAINT mytool_timeblocks_linked_task_id_work_items_fk
  FOREIGN KEY (linked_task_id) REFERENCES work_items(id) ON DELETE SET NULL;

-- ============================================================
-- Step 3: Remap mytool_email_links.linked_task_id FK from mytool_tasks → work_items
-- ============================================================
DO $$ BEGIN
  ALTER TABLE mytool_email_links DROP CONSTRAINT IF EXISTS mytool_email_links_linked_task_id_mytool_tasks_id_fk;
  ALTER TABLE mytool_email_links DROP CONSTRAINT IF EXISTS mytool_email_links_linked_task_id_fkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
ALTER TABLE mytool_email_links
  ADD CONSTRAINT mytool_email_links_linked_task_id_work_items_fk
  FOREIGN KEY (linked_task_id) REFERENCES work_items(id) ON DELETE CASCADE;

-- ============================================================
-- Step 4: Archive and drop mytool_tasks (0 active rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS _archive_mytool_tasks AS
  SELECT * FROM mytool_tasks;
DROP TABLE IF EXISTS mytool_tasks CASCADE;

-- ============================================================
-- Step 5: Drop legacy personal-task enums no longer referenced by any table
-- (Retained enums that are still used by active tables are NOT dropped)
-- ============================================================
DROP TYPE IF EXISTS mytool_task_status CASCADE;
DROP TYPE IF EXISTS mytool_task_priority CASCADE;
DROP TYPE IF EXISTS mytool_task_type CASCADE;
DROP TYPE IF EXISTS mytool_task_bucket CASCADE;
-- mytool_recurrence_frequency is still used by mytool_recurrence_templates
-- mytool_dependency_type was already dropped with mytool_task_dependencies
