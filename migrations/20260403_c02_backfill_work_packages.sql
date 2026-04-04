-- Backfill: 20260403_c02_backfill_work_packages.sql
-- Phase C.1: Populate core.work_packages from unique (project_id, workstream) on work_items.
-- Excludes personal tasks (no project_id) and PERSONAL workstream.
-- Title derived from workstream name.
-- Idempotent: ON CONFLICT (project_instance_id, workstream) DO NOTHING.
-- Must run AFTER: 20260403_c01_create_work_packages.sql
BEGIN;

-- -------------------------------------------------------
-- Safety check: warn about work_items with no project mapping
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched INTEGER;
BEGIN
  SELECT COUNT(DISTINCT wi.project_id) INTO _unmatched
  FROM work_items wi
  WHERE wi.project_id IS NOT NULL
    AND wi.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = wi.project_id
    );
  IF _unmatched > 0 THEN
    RAISE WARNING '[Phase C.1 backfill] % distinct project_id(s) on work_items not resolvable to project_instances', _unmatched;
  END IF;
END $$;

-- -------------------------------------------------------
-- Insert one work_package per unique (project, workstream)
-- -------------------------------------------------------
INSERT INTO core.work_packages (project_instance_id, workstream, title)
SELECT DISTINCT
  pi.id,
  wi.workstream,
  wi.workstream || ' Work Package'
FROM work_items wi
JOIN core.projects p ON p.legacy_project_info_id = wi.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE wi.project_id IS NOT NULL
  AND wi.deleted_at IS NULL
  AND wi.workstream <> 'PERSONAL'
ON CONFLICT (project_instance_id, workstream) DO NOTHING;

COMMIT;
