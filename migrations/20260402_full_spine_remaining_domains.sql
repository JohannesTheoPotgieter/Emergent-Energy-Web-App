-- Full Spine: Promote remaining 3 domains (approvals, deliverables, work_items)
-- Step 1: Add all missing columns to promoted tables
BEGIN;

-- ============================================================================
-- 1. documentation.document_approvals — add 15 missing columns from public.approvals
-- ============================================================================
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS requested_by INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT NOW();
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS decided_by INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS assigned_approver INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS scheduled_start_time TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS scheduled_end_time TEXT;

-- ============================================================================
-- 2. documentation.documents — add 23 missing columns from public.deliverables
-- ============================================================================
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS deliverable_type TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS owner_user_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS reviewer_user_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS qc_reviewer_user_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'TO DO';
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 1;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS sharepoint_folder_site_id TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS sharepoint_folder_drive_id TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS sharepoint_folder_item_id TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS scheduled_date TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS scheduled_start_time TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS scheduled_end_time TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS linked_cost_line_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS linked_revenue_line_id INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS original_file_name TEXT;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- ============================================================================
-- 3. core.work_items — add 61 missing columns from public.work_items
-- ============================================================================
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS workstream TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS end_date TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS percent_complete REAL;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS wbs_code TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS outline_number TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS parent_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS is_shared BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS legacy_table TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS scheduled_date TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS scheduled_start_time TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS scheduled_end_time TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS expected_pct_complete REAL;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS indent_level INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS source_row INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS baseline_start TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS baseline_end TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS baseline_duration INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS task_mode TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS actual_start TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS actual_end TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS actual_duration INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS task_category TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS recurrence_days_of_week TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS recurrence_end_date TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS blocked_type TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS approval_required BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS linked_deliverable_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS tracking_rag TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS task_type_tag TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS pd_ticket_id INTEGER;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS planned_hours REAL;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS actual_hours REAL;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS bucket TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS pinned_today BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS pinned_week BOOLEAN;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS source_email_id TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS source_email_subject TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS next_step TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS definition_of_done TEXT;
ALTER TABLE core.work_items ADD COLUMN IF NOT EXISTS completion_note TEXT;

COMMIT;
