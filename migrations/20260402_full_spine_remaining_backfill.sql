-- Full Spine Backfill: Remaining 3 domains
BEGIN;

-- ============================================================================
-- 1. documentation.document_approvals ← public.approvals
-- ============================================================================
UPDATE documentation.document_approvals da SET
  type = a.type,
  description = a.description,
  requested_by = a.requested_by,
  requested_at = a.requested_at,
  decided_by = a.decided_by,
  token = a.token,
  expires_at = a.expires_at,
  assigned_approver = a.assigned_approver,
  due_date = a.due_date,
  deleted_at = a.deleted_at,
  deleted_by = a.deleted_by,
  delete_reason = a.delete_reason,
  scheduled_date = a.scheduled_date,
  scheduled_start_time = a.scheduled_start_time,
  scheduled_end_time = a.scheduled_end_time,
  status = a.status,
  decision_note = a.decision_note
FROM public.approvals a
WHERE da.legacy_approval_id = a.id;

-- Also insert any approvals that don't have a promoted row yet
INSERT INTO documentation.document_approvals (
  document_id, legacy_approval_id, approval_type, approval_category, title,
  project_id, related_entity_type, related_entity_id, requested_by_user_id,
  urgency, status, decision_note, decided_at, source_table,
  type, description, requested_by, requested_at, decided_by, token,
  expires_at, assigned_approver, due_date, deleted_at, deleted_by,
  delete_reason, scheduled_date, scheduled_start_time, scheduled_end_time,
  last_synced_at, created_at
)
SELECT
  COALESCE((SELECT id FROM documentation.documents WHERE legacy_deliverable_id = a.related_entity_id LIMIT 1), 1),
  a.id, a.type, a.approval_category, a.title,
  a.project_id, a.related_entity_type, a.related_entity_id, a.requested_by,
  NULL, a.status, a.decision_note, a.decided_at, 'public.approvals',
  a.type, a.description, a.requested_by, a.requested_at, a.decided_by, a.token,
  a.expires_at, a.assigned_approver, a.due_date, a.deleted_at, a.deleted_by,
  a.delete_reason, a.scheduled_date, a.scheduled_start_time, a.scheduled_end_time,
  NOW(), a.requested_at
FROM public.approvals a
WHERE a.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM documentation.document_approvals da WHERE da.legacy_approval_id = a.id)
ON CONFLICT (legacy_approval_id) DO NOTHING;

-- ============================================================================
-- 2. documentation.documents ← public.deliverables
-- ============================================================================
UPDATE documentation.documents doc SET
  project_name = d.project_name,
  deliverable_type = d.deliverable_type,
  description = d.description,
  phase = d.phase,
  owner_user_id = d.owner_user_id,
  reviewer_user_id = d.reviewer_user_id,
  qc_reviewer_user_id = d.qc_reviewer_user_id,
  status = d.status,
  current_version = d.current_version,
  sharepoint_folder_site_id = d.sharepoint_folder_site_id,
  sharepoint_folder_drive_id = d.sharepoint_folder_drive_id,
  sharepoint_folder_item_id = d.sharepoint_folder_item_id,
  linked_plan_item_id = d.linked_plan_item_id,
  linked_quality_item_instance_id = d.linked_quality_item_instance_id,
  scheduled_date = d.scheduled_date,
  scheduled_start_time = d.scheduled_start_time,
  scheduled_end_time = d.scheduled_end_time,
  linked_cost_line_id = d.linked_cost_line_id,
  linked_revenue_line_id = d.linked_revenue_line_id,
  file_path = d.file_path,
  file_size = d.file_size,
  mime_type = d.mime_type,
  original_file_name = d.original_file_name
FROM public.deliverables d
WHERE doc.legacy_deliverable_id = d.id;

-- Insert deliverables that don't have promoted rows yet
INSERT INTO documentation.documents (
  legacy_deliverable_id, project_id, title, document_type, lifecycle_status,
  created_at, updated_at, source_table,
  project_name, deliverable_type, description, phase,
  owner_user_id, reviewer_user_id, qc_reviewer_user_id, status,
  current_version, sharepoint_folder_site_id, sharepoint_folder_drive_id,
  sharepoint_folder_item_id, linked_plan_item_id, linked_quality_item_instance_id,
  scheduled_date, scheduled_start_time, scheduled_end_time,
  linked_cost_line_id, linked_revenue_line_id, file_path, file_size,
  mime_type, original_file_name
)
SELECT
  d.id, d.project_id, d.title, d.deliverable_type, d.status,
  d.created_at, d.updated_at, 'public.deliverables',
  d.project_name, d.deliverable_type, d.description, d.phase,
  d.owner_user_id, d.reviewer_user_id, d.qc_reviewer_user_id, d.status,
  d.current_version, d.sharepoint_folder_site_id, d.sharepoint_folder_drive_id,
  d.sharepoint_folder_item_id, d.linked_plan_item_id, d.linked_quality_item_instance_id,
  d.scheduled_date, d.scheduled_start_time, d.scheduled_end_time,
  d.linked_cost_line_id, d.linked_revenue_line_id, d.file_path, d.file_size,
  d.mime_type, d.original_file_name
FROM public.deliverables d
WHERE NOT EXISTS (SELECT 1 FROM documentation.documents doc WHERE doc.legacy_deliverable_id = d.id)
ON CONFLICT (legacy_deliverable_id) DO NOTHING;

-- ============================================================================
-- 3. core.work_items ← public.work_items (full column sync)
-- ============================================================================
UPDATE core.work_items cw SET
  client_id = w.client_id,
  workstream = w.workstream::TEXT,
  type = w.type,
  source = w.source::TEXT,
  end_date = w.end_date,
  duration = w.duration,
  percent_complete = w.percent_complete,
  wbs_code = w.wbs_code,
  outline_number = w.outline_number,
  parent_id = w.parent_id,
  is_shared = w.is_shared,
  external_ref = w.external_ref,
  legacy_table = w.legacy_table,
  legacy_id = w.legacy_id,
  deleted_at = w.deleted_at,
  scheduled_date = w.scheduled_date,
  scheduled_start_time = w.scheduled_start_time,
  scheduled_end_time = w.scheduled_end_time,
  expected_pct_complete = w.expected_pct_complete,
  indent_level = w.indent_level,
  is_milestone = w.is_milestone,
  owner_name = w.owner_name,
  source_row = w.source_row,
  source_sheet = w.source_sheet,
  import_run_id = w.import_run_id,
  baseline_start = w.baseline_start,
  baseline_end = w.baseline_end,
  baseline_duration = w.baseline_duration,
  task_mode = w.task_mode,
  actual_start = w.actual_start,
  actual_end = w.actual_end,
  actual_duration = w.actual_duration,
  estimate_minutes = w.estimate_minutes,
  task_category = w.task_category,
  is_recurring = w.is_recurring,
  recurrence_frequency = w.recurrence_frequency,
  recurrence_interval = w.recurrence_interval,
  recurrence_days_of_week = w.recurrence_days_of_week,
  recurrence_end_date = w.recurrence_end_date,
  recurrence_parent_id = w.recurrence_parent_id,
  sub_project_name = w.sub_project_name,
  hold_reason = w.hold_reason,
  blocked_type = w.blocked_type,
  approval_required = w.approval_required,
  linked_plan_item_id = w.linked_plan_item_id,
  linked_deliverable_id = w.linked_deliverable_id,
  linked_quality_item_instance_id = w.linked_quality_item_instance_id,
  tracking_rag = w.tracking_rag,
  task_type_tag = w.task_type_tag,
  blocker_reason = w.blocker_reason,
  pd_ticket_id = w.pd_ticket_id,
  planned_hours = w.planned_hours,
  actual_hours = w.actual_hours,
  bucket = w.bucket,
  pinned_today = w.pinned_today,
  pinned_week = w.pinned_week,
  source_email_id = w.source_email_id,
  source_email_subject = w.source_email_subject,
  next_step = w.next_step,
  definition_of_done = w.definition_of_done,
  completion_note = w.completion_note,
  -- Also update foundation columns that may have drifted
  title = w.title,
  description = w.description,
  status = w.status,
  priority = w.priority,
  phase = w.phase,
  owner_user_id = w.owner_user_id,
  start_date = w.start_date,
  completed_at = w.completed_at,
  sort_order = COALESCE(w.sort_order, 0),
  updated_at = w.updated_at
FROM public.work_items w
WHERE cw.id = w.id;

-- Insert any work_items that don't exist in core yet (new since foundation backfill)
INSERT INTO core.work_items (
  id, legacy_work_items_id, project_id, parent_work_item_id, title, description,
  status, priority, phase, owner_user_id, due_date, start_date, completed_at,
  sort_order, created_by, created_at, updated_at, source_table,
  client_id, workstream, type, source, end_date, duration, percent_complete,
  wbs_code, outline_number, parent_id, is_shared, external_ref, legacy_table,
  legacy_id, deleted_at, scheduled_date, scheduled_start_time, scheduled_end_time,
  expected_pct_complete, indent_level, is_milestone, owner_name, source_row,
  source_sheet, import_run_id, baseline_start, baseline_end, baseline_duration,
  task_mode, actual_start, actual_end, actual_duration, estimate_minutes,
  task_category, is_recurring, recurrence_frequency, recurrence_interval,
  recurrence_days_of_week, recurrence_end_date, recurrence_parent_id,
  sub_project_name, hold_reason, blocked_type, approval_required,
  linked_plan_item_id, linked_deliverable_id, linked_quality_item_instance_id,
  tracking_rag, task_type_tag, blocker_reason, pd_ticket_id,
  planned_hours, actual_hours, bucket, pinned_today, pinned_week,
  source_email_id, source_email_subject, next_step, definition_of_done, completion_note
)
SELECT
  w.id, w.id, w.project_id, w.parent_id, w.title, w.description,
  w.status, w.priority, w.phase, w.owner_user_id, w.end_date, w.start_date, w.completed_at,
  COALESCE(w.sort_order, 0), w.created_by, w.created_at, w.updated_at, 'public.work_items',
  w.client_id, w.workstream::TEXT, w.type, w.source::TEXT, w.end_date, w.duration, w.percent_complete,
  w.wbs_code, w.outline_number, w.parent_id, w.is_shared, w.external_ref, w.legacy_table,
  w.legacy_id, w.deleted_at, w.scheduled_date, w.scheduled_start_time, w.scheduled_end_time,
  w.expected_pct_complete, w.indent_level, w.is_milestone, w.owner_name, w.source_row,
  w.source_sheet, w.import_run_id, w.baseline_start, w.baseline_end, w.baseline_duration,
  w.task_mode, w.actual_start, w.actual_end, w.actual_duration, w.estimate_minutes,
  w.task_category, w.is_recurring, w.recurrence_frequency, w.recurrence_interval,
  w.recurrence_days_of_week, w.recurrence_end_date, w.recurrence_parent_id,
  w.sub_project_name, w.hold_reason, w.blocked_type, w.approval_required,
  w.linked_plan_item_id, w.linked_deliverable_id, w.linked_quality_item_instance_id,
  w.tracking_rag, w.task_type_tag, w.blocker_reason, w.pd_ticket_id,
  w.planned_hours, w.actual_hours, w.bucket, w.pinned_today, w.pinned_week,
  w.source_email_id, w.source_email_subject, w.next_step, w.definition_of_done, w.completion_note
FROM public.work_items w
WHERE NOT EXISTS (SELECT 1 FROM core.work_items cw WHERE cw.id = w.id)
ON CONFLICT (id) DO NOTHING;

COMMIT;
