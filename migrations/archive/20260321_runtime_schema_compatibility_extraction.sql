-- Extracted runtime schema compatibility DDL from server/index.ts.
-- Transitional: this migration intentionally mirrors startup compatibility blocks.

ALTER TABLE IF EXISTS operational_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE IF EXISTS mytool_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS primary_instruction TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS stage_code TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS definition_of_done TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS owner_role_id TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS approver_role_id TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS required_links JSONB;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS example_artifacts JSONB;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS example_notes TEXT;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS common_pitfalls JSONB;
ALTER TABLE IF EXISTS ee_info_nodes ADD COLUMN IF NOT EXISTS next_node_id TEXT;

ALTER TABLE IF EXISTS ms_objects ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS smart_import_runs ADD COLUMN IF NOT EXISTS records_attempted INTEGER;
ALTER TABLE IF EXISTS smart_import_runs ADD COLUMN IF NOT EXISTS records_succeeded INTEGER;
ALTER TABLE IF EXISTS smart_import_runs ADD COLUMN IF NOT EXISTS records_failed INTEGER;
ALTER TABLE IF EXISTS smart_import_runs ADD COLUMN IF NOT EXISTS import_type TEXT;

ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS related_entity_id INTEGER;
ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS assigned_approver INTEGER;
ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE IF EXISTS approvals ADD COLUMN IF NOT EXISTS approval_category TEXT;
