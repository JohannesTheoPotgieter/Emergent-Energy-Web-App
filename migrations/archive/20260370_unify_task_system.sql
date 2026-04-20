-- Migration: Unify task system
-- Adds personal-task columns to work_items and makes projectId nullable
-- so that mytool_tasks can be migrated into the unified work_items table.

-- 1. Make project_id nullable (personal tasks may not belong to a project)
ALTER TABLE work_items ALTER COLUMN project_id DROP NOT NULL;

-- 2. Add personal-task columns (from mytool_tasks)
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS bucket text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pinned_today boolean DEFAULT false;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pinned_week boolean DEFAULT false;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_email_id text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_email_subject text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS next_step text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS definition_of_done text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completion_note text;

-- 3. Index for personal task queries
CREATE INDEX IF NOT EXISTS work_items_bucket_idx ON work_items (bucket) WHERE bucket IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_items_workstream_personal_idx ON work_items (owner_user_id) WHERE workstream = 'PERSONAL';
