-- Execution Gate fields on project_info
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE';
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_reason TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_status TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_document_link TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_phase TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS excel_tracker_link TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS canonical_project_id INTEGER;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS archived_status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Domain field on operational_tasks
ALTER TABLE operational_tasks ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'BOTH';

-- Merge audit log
CREATE TABLE IF NOT EXISTS merge_audit_log (
  id SERIAL PRIMARY KEY,
  primary_project_id INTEGER NOT NULL,
  secondary_project_id INTEGER NOT NULL,
  primary_project_name TEXT NOT NULL,
  secondary_project_name TEXT NOT NULL,
  merged_by_user_id INTEGER REFERENCES users(id),
  merged_by_role TEXT,
  reason TEXT,
  conflicts_json TEXT,
  moved_task_count INTEGER NOT NULL DEFAULT 0,
  moved_plan_count INTEGER NOT NULL DEFAULT 0,
  merged_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Execution gate log
CREATE TABLE IF NOT EXISTS execution_gate_log (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  changed_by_user_id INTEGER REFERENCES users(id),
  changed_by_role TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
