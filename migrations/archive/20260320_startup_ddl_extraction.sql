-- Hardening: move repeated startup schema repair DDL into explicit migration.
-- This migration is additive and non-destructive.

ALTER TABLE IF EXISTS project_info
  ADD COLUMN IF NOT EXISTS pm_user_id INTEGER REFERENCES users(id);

ALTER TABLE IF EXISTS project_eng_deliverables
  ADD COLUMN IF NOT EXISTS sharepoint_folder_path TEXT,
  ADD COLUMN IF NOT EXISTS project_eng_task_id INTEGER REFERENCES project_eng_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

ALTER TABLE IF EXISTS project_eng_tasks
  ADD COLUMN IF NOT EXISTS has_deliverable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS normalized_cost_lines
  ADD COLUMN IF NOT EXISTS no_revenue_linked BOOLEAN DEFAULT FALSE;
