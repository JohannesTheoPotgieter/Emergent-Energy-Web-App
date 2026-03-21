-- ============================================================
-- Rollback: Schema Consistency Fixes (QA Sweep 02)
-- ============================================================

DROP INDEX IF EXISTS idx_work_item_assignments_work_item_id;
DROP INDEX IF EXISTS idx_work_item_assignments_user_id;
DROP INDEX IF EXISTS idx_work_item_dependencies_predecessor_id;
DROP INDEX IF EXISTS idx_work_item_dependencies_successor_id;
DROP INDEX IF EXISTS idx_work_items_parent_id;
DROP INDEX IF EXISTS idx_work_items_owner_user_id;
DROP INDEX IF EXISTS idx_work_items_client_id;
DROP INDEX IF EXISTS idx_work_items_created_by;
DROP INDEX IF EXISTS idx_work_item_tags_work_item_id;
DROP INDEX IF EXISTS idx_work_item_tags_tag_id;
DROP INDEX IF EXISTS idx_task_time_entries_work_item_id;
DROP INDEX IF EXISTS idx_task_time_entries_user_id;
DROP INDEX IF EXISTS idx_task_checklist_items_checklist_id;
DROP INDEX IF EXISTS idx_project_eng_stages_project_id;
DROP INDEX IF EXISTS idx_project_eng_stages_stage_template_id;
DROP INDEX IF EXISTS idx_project_eng_tasks_stage_id;
DROP INDEX IF EXISTS idx_project_eng_tasks_work_item_id;
DROP INDEX IF EXISTS idx_project_eng_deliverables_stage_id;
DROP INDEX IF EXISTS idx_project_eng_approvals_stage_id;
DROP INDEX IF EXISTS idx_deliverable_versions_deliverable_id;
DROP INDEX IF EXISTS idx_deliverable_files_deliverable_id;
DROP INDEX IF EXISTS idx_deliverable_events_deliverable_id;
DROP INDEX IF EXISTS idx_qc_item_instance_checklist_id;
DROP INDEX IF EXISTS idx_qc_item_instance_template_item_id;
DROP INDEX IF EXISTS idx_qc_item_evidence_item_instance_id;
DROP INDEX IF EXISTS idx_qc_risk_answer_checklist_id;
DROP INDEX IF EXISTS idx_normalized_cost_lines_counterparty_id;
DROP INDEX IF EXISTS idx_approvals_requested_by;
DROP INDEX IF EXISTS idx_approvals_assigned_approver;
DROP INDEX IF EXISTS idx_project_phase_history_project_id;
DROP INDEX IF EXISTS idx_project_rag_audit_project_id;
DROP INDEX IF EXISTS idx_work_item_status_history_work_item_id;
DROP INDEX IF EXISTS idx_task_deliverables_sent_by;
DROP INDEX IF EXISTS idx_task_deliverables_recipient;
