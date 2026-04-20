-- Trustability lockdown migration (moved out of runtime startup)
-- Apply via migration process in controlled release windows.

ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS sharepoint_folder_path TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS no_revenue_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS has_deliverable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS project_eng_task_id INTEGER REFERENCES project_eng_tasks(id) ON DELETE SET NULL;
ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending';
ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

ALTER TABLE operational_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE mytool_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS primary_instruction TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS stage_code TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS definition_of_done TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS owner_role_id TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS approver_role_id TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS required_links JSONB;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS example_artifacts JSONB;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS example_notes TEXT;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS common_pitfalls JSONB;
ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS next_node_id TEXT;

ALTER TABLE ms_objects ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;
