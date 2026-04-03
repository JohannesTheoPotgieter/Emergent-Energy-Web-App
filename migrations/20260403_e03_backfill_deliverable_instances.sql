-- Backfill: 20260403_e03_backfill_deliverable_instances.sql
-- Phase E.3: Populate core.deliverable_instances from 3 source tables:
--   1. deliverables → engineering deliverables (owner, reviewer, versions, SharePoint)
--   2. project_eng_deliverables → stage-gated uploads (file metadata, approval)
--   3. task_deliverables → task-level handoffs (sender, recipient, acknowledgment)
-- Idempotent: ON CONFLICT (legacy_deliverable_table, legacy_deliverable_id) DO NOTHING.
-- Must run AFTER: 20260403_e02_backfill_deliverable_definitions.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings: detect unresolvable references
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_del_projects   INTEGER;
  _unmatched_eng_stages     INTEGER;
  _unmatched_task_workitems INTEGER;
  _unmatched_del_owners     INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_del_projects
  FROM deliverables d
  WHERE d.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = d.project_id
    );
  IF _unmatched_del_projects > 0 THEN
    RAISE WARNING '[Phase E.3 backfill] % deliverable(s) have a project_id not resolvable to project_instances', _unmatched_del_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_eng_stages
  FROM project_eng_deliverables ped
  WHERE NOT EXISTS (
    SELECT 1 FROM project_eng_stages pes
    JOIN core.projects p ON p.legacy_project_info_id = pes.project_id
    JOIN core.project_instances pi ON pi.legacy_project_id = p.id
    WHERE pes.id = ped.project_eng_stage_id
  );
  IF _unmatched_eng_stages > 0 THEN
    RAISE WARNING '[Phase E.3 backfill] % project_eng_deliverable(s) have an unresolvable stage → project chain', _unmatched_eng_stages;
  END IF;

  SELECT COUNT(*) INTO _unmatched_task_workitems
  FROM task_deliverables td
  WHERE td.work_item_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.work_items_clean wic WHERE wic.legacy_work_item_id = td.work_item_id
    );
  IF _unmatched_task_workitems > 0 THEN
    RAISE WARNING '[Phase E.3 backfill] % task_deliverable(s) have a work_item_id not resolvable to work_items_clean', _unmatched_task_workitems;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_del_owners
  FROM (
    SELECT d.owner_user_id AS user_id FROM deliverables d WHERE d.owner_user_id IS NOT NULL
    UNION ALL
    SELECT d.reviewer_user_id FROM deliverables d WHERE d.reviewer_user_id IS NOT NULL
    UNION ALL
    SELECT ped.uploaded_by FROM project_eng_deliverables ped WHERE ped.uploaded_by IS NOT NULL
    UNION ALL
    SELECT ped.approved_by FROM project_eng_deliverables ped WHERE ped.approved_by IS NOT NULL
    UNION ALL
    SELECT td.sent_by_user_id FROM task_deliverables td WHERE td.sent_by_user_id IS NOT NULL
    UNION ALL
    SELECT td.recipient_user_id FROM task_deliverables td WHERE td.recipient_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_del_owners > 0 THEN
    RAISE WARNING '[Phase E.3 backfill] % distinct user_id(s) not resolvable to user_accounts; party references will remain NULL', _unmatched_del_owners;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Engineering deliverables (from deliverables table)
-- -------------------------------------------------------
INSERT INTO core.deliverable_instances (
  legacy_deliverable_id, legacy_deliverable_table,
  project_instance_id, title, status, current_version,
  deliverable_data, created_at, updated_at
)
SELECT
  d.id,
  'deliverables',
  pi.id,
  d.title,
  LOWER(d.status),
  d.current_version,
  jsonb_build_object(
    'deliverable_type', d.deliverable_type,
    'description', d.description,
    'phase', d.phase,
    'sharepoint_folder_site_id', d.sharepoint_folder_site_id,
    'sharepoint_folder_drive_id', d.sharepoint_folder_drive_id,
    'sharepoint_folder_item_id', d.sharepoint_folder_item_id,
    'linked_plan_item_id', d.linked_plan_item_id,
    'linked_quality_item_instance_id', d.linked_quality_item_instance_id,
    'qc_reviewer_user_id', d.qc_reviewer_user_id
  ),
  d.created_at,
  d.updated_at
FROM deliverables d
JOIN core.projects p ON p.legacy_project_info_id = d.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_deliverable_table, legacy_deliverable_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Stage-gated engineering deliverables (from project_eng_deliverables)
-- -------------------------------------------------------
INSERT INTO core.deliverable_instances (
  legacy_deliverable_id, legacy_deliverable_table,
  deliverable_definition_id, project_instance_id,
  title, status, completed_at,
  deliverable_data, created_at
)
SELECT
  ped.id,
  'project_eng_deliverables',
  dd.id,
  pi.id,
  COALESCE(ped.file_name, edt.name, 'Untitled'),
  LOWER(COALESCE(ped.approval_status, 'pending')),
  ped.approved_at,
  jsonb_build_object(
    'file_name', ped.file_name,
    'file_size', ped.file_size,
    'mime_type', ped.mime_type,
    'storage_ref', ped.storage_ref,
    'version_tag', ped.version_tag,
    'notes', ped.notes,
    'sharepoint_folder_path', ped.sharepoint_folder_path,
    'project_eng_stage_id', ped.project_eng_stage_id,
    'project_eng_task_id', ped.project_eng_task_id
  ),
  COALESCE(ped.uploaded_at, NOW())
FROM project_eng_deliverables ped
JOIN project_eng_stages pes ON pes.id = ped.project_eng_stage_id
JOIN core.projects p ON p.legacy_project_info_id = pes.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
LEFT JOIN eng_deliverable_templates edt ON edt.id = ped.deliverable_template_id
LEFT JOIN core.deliverable_definitions dd ON dd.legacy_template_id = ped.deliverable_template_id
ON CONFLICT (legacy_deliverable_table, legacy_deliverable_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Task-level deliverables (from task_deliverables)
-- -------------------------------------------------------
INSERT INTO core.deliverable_instances (
  legacy_deliverable_id, legacy_deliverable_table,
  project_instance_id, title, status, completed_at,
  deliverable_data, created_at
)
SELECT
  td.id,
  'task_deliverables',
  wic.project_instance_id,
  COALESCE(td.original_name, td.filename, 'Task Deliverable'),
  CASE WHEN td.acknowledged THEN 'acknowledged' ELSE 'pending' END,
  td.acknowledged_at,
  jsonb_build_object(
    'filename', td.filename,
    'original_name', td.original_name,
    'file_size', td.file_size,
    'note', td.note,
    'work_item_id', td.work_item_id,
    'acknowledged', td.acknowledged
  ),
  td.created_at
FROM task_deliverables td
JOIN core.work_items_clean wic ON wic.legacy_work_item_id = td.work_item_id
ON CONFLICT (legacy_deliverable_table, legacy_deliverable_id) DO NOTHING;

-- -------------------------------------------------------
-- 4. Resolve owner_party_id and reviewer_party_id
-- -------------------------------------------------------

-- deliverables: owner = owner_user_id
UPDATE core.deliverable_instances di
SET owner_party_id = ua.party_id
FROM deliverables d
JOIN core.user_accounts ua ON ua.legacy_user_id = d.owner_user_id
WHERE di.legacy_deliverable_table = 'deliverables'
  AND di.legacy_deliverable_id = d.id
  AND d.owner_user_id IS NOT NULL
  AND di.owner_party_id IS NULL;

-- deliverables: reviewer = reviewer_user_id
UPDATE core.deliverable_instances di
SET reviewer_party_id = ua.party_id
FROM deliverables d
JOIN core.user_accounts ua ON ua.legacy_user_id = d.reviewer_user_id
WHERE di.legacy_deliverable_table = 'deliverables'
  AND di.legacy_deliverable_id = d.id
  AND d.reviewer_user_id IS NOT NULL
  AND di.reviewer_party_id IS NULL;

-- project_eng_deliverables: owner = uploaded_by, reviewer = approved_by
UPDATE core.deliverable_instances di
SET owner_party_id = ua.party_id
FROM project_eng_deliverables ped
JOIN core.user_accounts ua ON ua.legacy_user_id = ped.uploaded_by
WHERE di.legacy_deliverable_table = 'project_eng_deliverables'
  AND di.legacy_deliverable_id = ped.id
  AND ped.uploaded_by IS NOT NULL
  AND di.owner_party_id IS NULL;

UPDATE core.deliverable_instances di
SET reviewer_party_id = ua.party_id
FROM project_eng_deliverables ped
JOIN core.user_accounts ua ON ua.legacy_user_id = ped.approved_by
WHERE di.legacy_deliverable_table = 'project_eng_deliverables'
  AND di.legacy_deliverable_id = ped.id
  AND ped.approved_by IS NOT NULL
  AND di.reviewer_party_id IS NULL;

-- task_deliverables: owner = sent_by_user_id, reviewer = recipient_user_id
UPDATE core.deliverable_instances di
SET owner_party_id = ua.party_id
FROM task_deliverables td
JOIN core.user_accounts ua ON ua.legacy_user_id = td.sent_by_user_id
WHERE di.legacy_deliverable_table = 'task_deliverables'
  AND di.legacy_deliverable_id = td.id
  AND td.sent_by_user_id IS NOT NULL
  AND di.owner_party_id IS NULL;

UPDATE core.deliverable_instances di
SET reviewer_party_id = ua.party_id
FROM task_deliverables td
JOIN core.user_accounts ua ON ua.legacy_user_id = td.recipient_user_id
WHERE di.legacy_deliverable_table = 'task_deliverables'
  AND di.legacy_deliverable_id = td.id
  AND td.recipient_user_id IS NOT NULL
  AND di.reviewer_party_id IS NULL;

COMMIT;
