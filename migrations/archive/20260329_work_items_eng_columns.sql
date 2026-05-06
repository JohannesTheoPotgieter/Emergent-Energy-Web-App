-- Add engineering-specific columns to work_items table
-- Enables migration away from operational_tasks for engineering endpoints

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocked_type TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_deliverable_id INTEGER;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS tracking_rag TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_type_tag TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocker_reason TEXT;

-- Link stage tasks to canonical work items
ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id);
