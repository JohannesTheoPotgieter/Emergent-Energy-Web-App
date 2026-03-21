-- ============================================================
-- Schema Consistency Fixes (QA Sweep 02)
-- Adds missing FK indexes for query performance.
-- ============================================================

-- ── CRITICAL: work_item_assignments ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_item_assignments_work_item_id
  ON work_item_assignments (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_assignments_user_id
  ON work_item_assignments (user_id);

-- ── CRITICAL: work_item_dependencies ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_predecessor_id
  ON work_item_dependencies (predecessor_id);
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_successor_id
  ON work_item_dependencies (successor_id);

-- ── HIGH: work_items self-join & owner ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_items_parent_id
  ON work_items (parent_id);
CREATE INDEX IF NOT EXISTS idx_work_items_owner_user_id
  ON work_items (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_work_items_client_id
  ON work_items (client_id);
CREATE INDEX IF NOT EXISTS idx_work_items_created_by
  ON work_items (created_by);

-- ── HIGH: work_item_tags ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_item_tags_work_item_id
  ON work_item_tags (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_tags_tag_id
  ON work_item_tags (tag_id);

-- ── HIGH: task_time_entries ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_time_entries_work_item_id
  ON task_time_entries (work_item_id);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_user_id
  ON task_time_entries (user_id);

-- ── HIGH: task_checklist_items ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_checklist_items_checklist_id
  ON task_checklist_items (checklist_id);

-- ── HIGH: engineering tables ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_eng_stages_project_id
  ON project_eng_stages (project_id);
CREATE INDEX IF NOT EXISTS idx_project_eng_stages_stage_template_id
  ON project_eng_stages (stage_template_id);

CREATE INDEX IF NOT EXISTS idx_project_eng_tasks_stage_id
  ON project_eng_tasks (project_eng_stage_id);
CREATE INDEX IF NOT EXISTS idx_project_eng_tasks_work_item_id
  ON project_eng_tasks (work_item_id);

CREATE INDEX IF NOT EXISTS idx_project_eng_deliverables_stage_id
  ON project_eng_deliverables (project_eng_stage_id);

CREATE INDEX IF NOT EXISTS idx_project_eng_approvals_stage_id
  ON project_eng_approvals (project_eng_stage_id);

-- ── HIGH: deliverable sub-tables ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deliverable_versions_deliverable_id
  ON deliverable_versions (deliverable_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_files_deliverable_id
  ON deliverable_files (deliverable_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_events_deliverable_id
  ON deliverable_events (deliverable_id);

-- ── HIGH: QC tables ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qc_item_instance_checklist_id
  ON qc_item_instance (checklist_id);
CREATE INDEX IF NOT EXISTS idx_qc_item_instance_template_item_id
  ON qc_item_instance (template_item_id);
CREATE INDEX IF NOT EXISTS idx_qc_item_evidence_item_instance_id
  ON qc_item_evidence (item_instance_id);
CREATE INDEX IF NOT EXISTS idx_qc_risk_answer_checklist_id
  ON qc_risk_answer (checklist_id);

-- ── MEDIUM: finance & misc ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_counterparty_id
  ON normalized_cost_lines (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_approvals_requested_by
  ON approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_approvals_assigned_approver
  ON approvals (assigned_approver);
CREATE INDEX IF NOT EXISTS idx_project_phase_history_project_id
  ON project_phase_history (project_id);
CREATE INDEX IF NOT EXISTS idx_project_rag_audit_project_id
  ON project_rag_audit (project_id);

-- ── MEDIUM: status history & comments ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_item_status_history_work_item_id
  ON work_item_status_history (work_item_id);
CREATE INDEX IF NOT EXISTS idx_task_deliverables_sent_by
  ON task_deliverables (sent_by_user_id);
CREATE INDEX IF NOT EXISTS idx_task_deliverables_recipient
  ON task_deliverables (recipient_user_id);
