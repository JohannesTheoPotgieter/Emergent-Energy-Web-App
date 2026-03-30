-- Migration: Move existing mytool_tasks data into work_items
-- This is a one-time data migration. After this, mytool CRUD operates on work_items.
-- Original mytool_tasks rows are preserved (not deleted) for safety.

-- Status mapping: mytool → work_items
-- inbox     → TO DO
-- planned   → TO DO
-- in_progress → IN PROGRESS
-- blocked   → HOLD
-- waiting   → HOLD
-- done      → COMPLETE
-- cancelled → COMPLETE

-- Priority mapping: mytool → work_items
-- low      → Low
-- normal   → Med
-- high     → High
-- critical → Urgent

INSERT INTO work_items (
  project_id,
  workstream,
  source,
  title,
  description,
  status,
  priority,
  start_date,
  end_date,
  owner_user_id,
  created_by,
  scheduled_date,
  scheduled_start_time,
  scheduled_end_time,
  sort_order,
  is_recurring,
  recurrence_frequency,
  recurrence_interval,
  recurrence_days_of_week,
  recurrence_end_date,
  recurrence_parent_id,
  type,
  hold_reason,
  task_type_tag,
  bucket,
  pinned_today,
  pinned_week,
  source_email_id,
  source_email_subject,
  next_step,
  definition_of_done,
  completion_note,
  completed_at,
  deleted_at,
  created_at,
  updated_at,
  legacy_table,
  legacy_id
)
SELECT
  mt.project_id,
  'PERSONAL'::work_item_workstream,
  'SYSTEM'::work_item_source,
  mt.title,
  mt.notes,
  CASE mt.status
    WHEN 'inbox' THEN 'TO DO'
    WHEN 'planned' THEN 'TO DO'
    WHEN 'in_progress' THEN 'IN PROGRESS'
    WHEN 'blocked' THEN 'HOLD'
    WHEN 'waiting' THEN 'HOLD'
    WHEN 'done' THEN 'COMPLETE'
    WHEN 'cancelled' THEN 'COMPLETE'
    ELSE 'TO DO'
  END,
  CASE mt.priority
    WHEN 'low' THEN 'Low'
    WHEN 'normal' THEN 'Med'
    WHEN 'high' THEN 'High'
    WHEN 'critical' THEN 'Urgent'
    ELSE 'Med'
  END,
  mt.start_date::date,
  CASE WHEN mt.due_at IS NOT NULL THEN mt.due_at::date ELSE NULL END,
  mt.owner_user_id,
  mt.owner_user_id,  -- createdBy = ownerUserId
  mt.planned_for_date,
  mt.scheduled_start_time,
  mt.scheduled_end_time,
  mt.sort_order,
  mt.is_recurring,
  mt.recurrence_frequency::text,
  mt.recurrence_interval,
  mt.recurrence_days_of_week,
  mt.recurrence_end_date::date,
  mt.recurrence_parent_id,
  CASE WHEN mt.task_type = 'milestone' THEN 'milestone' ELSE NULL END,
  mt.blocked_reason,
  mt.tag,
  mt.bucket::text,
  mt.pinned_today,
  mt.pinned_week,
  mt.source_email_id,
  mt.source_email_subject,
  mt.next_step,
  mt.definition_of_done,
  mt.completion_note,
  mt.completed_at,
  mt.deleted_at,
  mt.created_at,
  mt.updated_at,
  'mytool_tasks',
  mt.id
FROM mytool_tasks mt
WHERE NOT EXISTS (
  SELECT 1 FROM work_items wi
  WHERE wi.legacy_table = 'mytool_tasks' AND wi.legacy_id = mt.id
);

-- Create OWNER assignments for migrated personal tasks
INSERT INTO work_item_assignments (work_item_id, user_id, role)
SELECT wi.id, wi.owner_user_id, 'OWNER'::work_item_assignment_role
FROM work_items wi
WHERE wi.legacy_table = 'mytool_tasks'
  AND wi.owner_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM work_item_assignments wia
    WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id AND wia.role = 'OWNER'
  );
