-- Full Spine View Swap: Replace legacy tables with auto-updatable views
-- that read from promoted schema tables.
--
-- Strategy:
--   1. Rename legacy table to _legacy suffix
--   2. Create an auto-updatable view with the original table name
--   3. The view maps promoted columns to legacy column names
--   4. PostgreSQL auto-updatable views support INSERT/UPDATE/DELETE natively
--   5. Add INSTEAD OF triggers for complex cases
--
-- IMPORTANT: This is reversible by dropping the views and renaming _legacy back.
BEGIN;

-- ============================================================================
-- 1. APPROVALS: public.approvals → documentation.document_approvals
-- ============================================================================

ALTER TABLE public.approvals RENAME TO _approvals_legacy;

CREATE OR REPLACE VIEW public.approvals AS
SELECT
  da.legacy_approval_id AS id,
  da.type,
  da.title,
  da.description,
  da.status,
  da.decision_note,
  da.decided_at,
  da.requested_by,
  da.requested_at,
  da.decided_by,
  da.token,
  da.expires_at,
  da.assigned_approver,
  da.due_date,
  da.project_id,
  da.approval_category,
  da.approval_type,
  da.related_entity_type,
  da.related_entity_id,
  da.requested_by_user_id AS requested_by_user_id,
  da.urgency,
  da.evidence_links,
  da.deleted_at,
  da.deleted_by,
  da.delete_reason,
  da.scheduled_date,
  da.scheduled_start_time,
  da.scheduled_end_time,
  da.created_at
FROM documentation.document_approvals da
WHERE da.legacy_approval_id IS NOT NULL;

-- Trigger: INSERT into the view writes to promoted table
CREATE OR REPLACE FUNCTION public._approvals_view_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO documentation.document_approvals (
    document_id, legacy_approval_id, type, title, description, status,
    decision_note, decided_at, requested_by, requested_at, decided_by,
    token, expires_at, assigned_approver, due_date, project_id,
    approval_category, approval_type, related_entity_type, related_entity_id,
    requested_by_user_id, urgency, evidence_links, deleted_at, deleted_by,
    delete_reason, scheduled_date, scheduled_start_time, scheduled_end_time,
    source_table, last_synced_at, created_at
  ) VALUES (
    1, NEW.id, NEW.type, NEW.title, NEW.description, NEW.status,
    NEW.decision_note, NEW.decided_at, NEW.requested_by, COALESCE(NEW.requested_at, NOW()), NEW.decided_by,
    NEW.token, NEW.expires_at, NEW.assigned_approver, NEW.due_date, NEW.project_id,
    NEW.approval_category, NEW.approval_type, NEW.related_entity_type, NEW.related_entity_id,
    NEW.requested_by, NEW.urgency, NEW.evidence_links, NEW.deleted_at, NEW.deleted_by,
    NEW.delete_reason, NEW.scheduled_date, NEW.scheduled_start_time, NEW.scheduled_end_time,
    'public.approvals', NOW(), COALESCE(NEW.requested_at, NOW())
  );
  -- Also insert into legacy table to maintain backward compatibility
  INSERT INTO public._approvals_legacy VALUES (NEW.*);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._approvals_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE documentation.document_approvals SET
    status = NEW.status,
    decision_note = NEW.decision_note,
    decided_at = NEW.decided_at,
    decided_by = NEW.decided_by,
    assigned_approver = NEW.assigned_approver,
    due_date = NEW.due_date,
    deleted_at = NEW.deleted_at,
    deleted_by = NEW.deleted_by,
    delete_reason = NEW.delete_reason,
    scheduled_date = NEW.scheduled_date,
    scheduled_start_time = NEW.scheduled_start_time,
    scheduled_end_time = NEW.scheduled_end_time,
    last_synced_at = NOW()
  WHERE legacy_approval_id = NEW.id;
  -- Also update legacy table
  UPDATE public._approvals_legacy SET
    status = NEW.status, decision_note = NEW.decision_note,
    decided_at = NEW.decided_at, decided_by = NEW.decided_by,
    assigned_approver = NEW.assigned_approver, due_date = NEW.due_date,
    deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approvals_view_insert INSTEAD OF INSERT ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public._approvals_view_insert();
CREATE TRIGGER approvals_view_update INSTEAD OF UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public._approvals_view_update();

-- ============================================================================
-- 2. DELIVERABLES: public.deliverables → documentation.documents
-- ============================================================================

ALTER TABLE public.deliverables RENAME TO _deliverables_legacy;

CREATE OR REPLACE VIEW public.deliverables AS
SELECT
  doc.legacy_deliverable_id AS id,
  doc.project_id,
  doc.project_name,
  doc.title,
  doc.deliverable_type,
  doc.description,
  doc.phase,
  doc.owner_user_id,
  doc.reviewer_user_id,
  doc.qc_reviewer_user_id,
  doc.status,
  doc.current_version,
  doc.sharepoint_folder_site_id,
  doc.sharepoint_folder_drive_id,
  doc.sharepoint_folder_item_id,
  doc.linked_plan_item_id,
  doc.linked_quality_item_instance_id,
  doc.scheduled_date,
  doc.scheduled_start_time,
  doc.scheduled_end_time,
  doc.linked_cost_line_id,
  doc.linked_revenue_line_id,
  doc.file_path,
  doc.file_size,
  doc.mime_type,
  doc.original_file_name,
  doc.created_by,
  doc.created_at,
  doc.updated_at
FROM documentation.documents doc
WHERE doc.legacy_deliverable_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._deliverables_view_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO documentation.documents (
    legacy_deliverable_id, project_id, title, document_type, lifecycle_status,
    source_table, project_name, deliverable_type, description, phase,
    owner_user_id, reviewer_user_id, qc_reviewer_user_id, status, current_version,
    sharepoint_folder_site_id, sharepoint_folder_drive_id, sharepoint_folder_item_id,
    linked_plan_item_id, linked_quality_item_instance_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, linked_cost_line_id, linked_revenue_line_id,
    file_path, file_size, mime_type, original_file_name, created_by, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.project_id, NEW.title, NEW.deliverable_type, NEW.status,
    'public.deliverables', NEW.project_name, NEW.deliverable_type, NEW.description, NEW.phase,
    NEW.owner_user_id, NEW.reviewer_user_id, NEW.qc_reviewer_user_id, NEW.status, COALESCE(NEW.current_version, 1),
    NEW.sharepoint_folder_site_id, NEW.sharepoint_folder_drive_id, NEW.sharepoint_folder_item_id,
    NEW.linked_plan_item_id, NEW.linked_quality_item_instance_id, NEW.scheduled_date,
    NEW.scheduled_start_time, NEW.scheduled_end_time, NEW.linked_cost_line_id, NEW.linked_revenue_line_id,
    NEW.file_path, NEW.file_size, NEW.mime_type, NEW.original_file_name, NEW.created_by, NOW(), NOW()
  );
  INSERT INTO public._deliverables_legacy VALUES (NEW.*);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._deliverables_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE documentation.documents SET
    title = NEW.title, status = NEW.status, phase = NEW.phase,
    description = NEW.description, owner_user_id = NEW.owner_user_id,
    reviewer_user_id = NEW.reviewer_user_id, current_version = NEW.current_version,
    file_path = NEW.file_path, file_size = NEW.file_size, mime_type = NEW.mime_type,
    original_file_name = NEW.original_file_name, updated_at = NOW()
  WHERE legacy_deliverable_id = NEW.id;
  UPDATE public._deliverables_legacy SET
    title = NEW.title, status = NEW.status, phase = NEW.phase,
    description = NEW.description, owner_user_id = NEW.owner_user_id
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliverables_view_insert INSTEAD OF INSERT ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public._deliverables_view_insert();
CREATE TRIGGER deliverables_view_update INSTEAD OF UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public._deliverables_view_update();

-- ============================================================================
-- 3. WORK_ITEMS: public.work_items → core.work_items
-- ============================================================================

ALTER TABLE public.work_items RENAME TO _work_items_legacy;

CREATE OR REPLACE VIEW public.work_items AS
SELECT
  cw.id, cw.client_id, cw.project_id, cw.workstream::TEXT AS workstream,
  cw.type, cw.source::TEXT AS source, cw.title, cw.description,
  cw.status, cw.priority, cw.start_date,
  cw.end_date, cw.duration, cw.percent_complete,
  cw.wbs_code, cw.outline_number, cw.parent_id,
  cw.owner_user_id, cw.is_shared, cw.external_ref,
  cw.legacy_table, cw.legacy_id,
  cw.created_by, cw.created_at, cw.updated_at, cw.deleted_at,
  cw.scheduled_date, cw.scheduled_start_time, cw.scheduled_end_time,
  cw.expected_pct_complete, cw.indent_level, cw.is_milestone,
  cw.phase, cw.owner_name, cw.source_row, cw.source_sheet,
  cw.import_run_id, cw.baseline_start, cw.baseline_end,
  cw.baseline_duration, cw.task_mode, cw.actual_start, cw.actual_end,
  cw.actual_duration, cw.sort_order, cw.estimate_minutes,
  cw.task_category, cw.is_recurring, cw.recurrence_frequency,
  cw.recurrence_interval, cw.recurrence_days_of_week,
  cw.recurrence_end_date, cw.recurrence_parent_id,
  cw.sub_project_name, cw.hold_reason, cw.blocked_type,
  cw.approval_required, cw.linked_plan_item_id,
  cw.linked_deliverable_id, cw.linked_quality_item_instance_id,
  cw.completed_at, cw.tracking_rag, cw.task_type_tag,
  cw.blocker_reason, cw.pd_ticket_id,
  cw.planned_hours, cw.actual_hours, cw.bucket,
  cw.pinned_today, cw.pinned_week,
  cw.source_email_id, cw.source_email_subject,
  cw.next_step, cw.definition_of_done, cw.completion_note
FROM core.work_items cw;

CREATE OR REPLACE FUNCTION public._work_items_view_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO core.work_items (
    id, client_id, project_id, workstream, type, source, title, description,
    status, priority, start_date, end_date, duration, percent_complete,
    wbs_code, outline_number, parent_id, parent_work_item_id,
    owner_user_id, is_shared, external_ref, legacy_table, legacy_id,
    created_by, created_at, updated_at, deleted_at,
    scheduled_date, scheduled_start_time, scheduled_end_time,
    expected_pct_complete, indent_level, is_milestone, phase,
    owner_name, source_row, source_sheet, import_run_id,
    baseline_start, baseline_end, baseline_duration, task_mode,
    actual_start, actual_end, actual_duration, sort_order,
    estimate_minutes, task_category, is_recurring, recurrence_frequency,
    recurrence_interval, recurrence_days_of_week, recurrence_end_date,
    recurrence_parent_id, sub_project_name, hold_reason, blocked_type,
    approval_required, linked_plan_item_id, linked_deliverable_id,
    linked_quality_item_instance_id, completed_at, tracking_rag,
    task_type_tag, blocker_reason, pd_ticket_id, planned_hours,
    actual_hours, bucket, pinned_today, pinned_week,
    source_email_id, source_email_subject, next_step,
    definition_of_done, completion_note, source_table
  ) VALUES (
    NEW.id, NEW.client_id, NEW.project_id, NEW.workstream, NEW.type, NEW.source, NEW.title, NEW.description,
    NEW.status, NEW.priority, NEW.start_date, NEW.end_date, NEW.duration, NEW.percent_complete,
    NEW.wbs_code, NEW.outline_number, NEW.parent_id, NEW.parent_id,
    NEW.owner_user_id, NEW.is_shared, NEW.external_ref, NEW.legacy_table, NEW.legacy_id,
    NEW.created_by, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW()), NEW.deleted_at,
    NEW.scheduled_date, NEW.scheduled_start_time, NEW.scheduled_end_time,
    NEW.expected_pct_complete, NEW.indent_level, NEW.is_milestone, NEW.phase,
    NEW.owner_name, NEW.source_row, NEW.source_sheet, NEW.import_run_id,
    NEW.baseline_start, NEW.baseline_end, NEW.baseline_duration, NEW.task_mode,
    NEW.actual_start, NEW.actual_end, NEW.actual_duration, COALESCE(NEW.sort_order, 0),
    NEW.estimate_minutes, NEW.task_category, NEW.is_recurring, NEW.recurrence_frequency,
    NEW.recurrence_interval, NEW.recurrence_days_of_week, NEW.recurrence_end_date,
    NEW.recurrence_parent_id, NEW.sub_project_name, NEW.hold_reason, NEW.blocked_type,
    NEW.approval_required, NEW.linked_plan_item_id, NEW.linked_deliverable_id,
    NEW.linked_quality_item_instance_id, NEW.completed_at, NEW.tracking_rag,
    NEW.task_type_tag, NEW.blocker_reason, NEW.pd_ticket_id, NEW.planned_hours,
    NEW.actual_hours, NEW.bucket, NEW.pinned_today, NEW.pinned_week,
    NEW.source_email_id, NEW.source_email_subject, NEW.next_step,
    NEW.definition_of_done, NEW.completion_note, 'public.work_items'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status, title = EXCLUDED.title, description = EXCLUDED.description,
    priority = EXCLUDED.priority, owner_user_id = EXCLUDED.owner_user_id,
    updated_at = NOW(), deleted_at = EXCLUDED.deleted_at;
  -- Also maintain legacy table
  INSERT INTO public._work_items_legacy VALUES (NEW.*)
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status, title = EXCLUDED.title, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._work_items_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE core.work_items SET
    status = NEW.status, title = NEW.title, description = NEW.description,
    priority = NEW.priority, phase = NEW.phase,
    owner_user_id = NEW.owner_user_id, end_date = NEW.end_date,
    start_date = NEW.start_date, completed_at = NEW.completed_at,
    percent_complete = NEW.percent_complete, deleted_at = NEW.deleted_at,
    sort_order = COALESCE(NEW.sort_order, sort_order),
    hold_reason = NEW.hold_reason, blocked_type = NEW.blocked_type,
    tracking_rag = NEW.tracking_rag, task_type_tag = NEW.task_type_tag,
    next_step = NEW.next_step, definition_of_done = NEW.definition_of_done,
    completion_note = NEW.completion_note,
    pinned_today = NEW.pinned_today, pinned_week = NEW.pinned_week,
    bucket = NEW.bucket,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;
  UPDATE public._work_items_legacy SET
    status = NEW.status, title = NEW.title, description = NEW.description,
    priority = NEW.priority, owner_user_id = NEW.owner_user_id,
    updated_at = COALESCE(NEW.updated_at, NOW()), deleted_at = NEW.deleted_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._work_items_view_delete() RETURNS trigger AS $$
BEGIN
  UPDATE core.work_items SET deleted_at = NOW() WHERE id = OLD.id;
  DELETE FROM public._work_items_legacy WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_items_view_insert INSTEAD OF INSERT ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public._work_items_view_insert();
CREATE TRIGGER work_items_view_update INSTEAD OF UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public._work_items_view_update();
CREATE TRIGGER work_items_view_delete INSTEAD OF DELETE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public._work_items_view_delete();

COMMIT;
