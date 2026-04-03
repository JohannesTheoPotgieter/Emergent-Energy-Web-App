-- Backfill: 20260403_c04_backfill_work_items_clean.sql
-- Phase C.2: Populate core.work_items_clean from work_items.
-- Resolves:
--   work_package_id   via (project_instance_id, workstream) → work_packages
--   project_instance_id via project_id → core.projects → project_instances
--   assigned_to_party_id via owner_user_id → user_accounts → parties
--   parent_id          via two-pass: first insert all rows, then update parent_id
-- Idempotent: ON CONFLICT (legacy_work_item_id) DO NOTHING.
-- Must run AFTER: 20260403_c03_create_work_items_clean.sql
BEGIN;

-- -------------------------------------------------------
-- Safety check: warn about unresolvable references
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_project INTEGER;
  _unmatched_owner INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_project
  FROM work_items wi
  WHERE wi.project_id IS NOT NULL
    AND wi.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = wi.project_id
    );
  IF _unmatched_project > 0 THEN
    RAISE WARNING '[Phase C.2 backfill] % work_item(s) have a project_id not resolvable to project_instances', _unmatched_project;
  END IF;

  SELECT COUNT(*) INTO _unmatched_owner
  FROM work_items wi
  WHERE wi.owner_user_id IS NOT NULL
    AND wi.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = wi.owner_user_id
    );
  IF _unmatched_owner > 0 THEN
    RAISE WARNING '[Phase C.2 backfill] % work_item(s) have an owner_user_id not resolvable to a party', _unmatched_owner;
  END IF;
END $$;

-- -------------------------------------------------------
-- Step 1: Insert all work items (parent_id left NULL initially)
-- -------------------------------------------------------
INSERT INTO core.work_items_clean (
  legacy_work_item_id,
  work_package_id,
  project_instance_id,
  assigned_to_party_id,
  title,
  description,
  status,
  priority,
  start_date,
  end_date,
  percent_complete,
  is_milestone,
  sort_order,
  created_at,
  updated_at
)
SELECT
  wi.id,
  wp.id,
  pi.id,
  ua.party_id,
  wi.title,
  wi.description,
  wi.status,
  wi.priority,
  wi.start_date::DATE,
  wi.end_date::DATE,
  wi.percent_complete,
  wi.is_milestone,
  wi.sort_order,
  wi.created_at,
  wi.updated_at
FROM work_items wi
LEFT JOIN core.projects p ON p.legacy_project_info_id = wi.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
LEFT JOIN core.work_packages wp ON wp.project_instance_id = pi.id AND wp.workstream = wi.workstream
LEFT JOIN core.user_accounts ua ON ua.legacy_user_id = wi.owner_user_id
WHERE wi.deleted_at IS NULL
ON CONFLICT (legacy_work_item_id) DO NOTHING;

-- -------------------------------------------------------
-- Safety check: warn about orphaned parent_id references
-- -------------------------------------------------------
DO $$
DECLARE
  _orphaned_parents INTEGER;
BEGIN
  SELECT COUNT(*) INTO _orphaned_parents
  FROM work_items wi
  WHERE wi.deleted_at IS NULL
    AND wi.parent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.work_items_clean wic
      WHERE wic.legacy_work_item_id = wi.parent_id
    );
  IF _orphaned_parents > 0 THEN
    RAISE WARNING '[Phase C.2 backfill] % work_item(s) have parent_id referencing deleted items; parent_id will remain NULL', _orphaned_parents;
  END IF;
END $$;

-- -------------------------------------------------------
-- Step 2: Resolve parent_id references
-- Uses legacy parent_id to find the corresponding clean row.
-- -------------------------------------------------------
UPDATE core.work_items_clean wic
SET parent_id = parent_clean.id
FROM work_items wi
JOIN core.work_items_clean parent_clean ON parent_clean.legacy_work_item_id = wi.parent_id
WHERE wic.legacy_work_item_id = wi.id
  AND wi.parent_id IS NOT NULL
  AND wic.parent_id IS NULL;

COMMIT;
