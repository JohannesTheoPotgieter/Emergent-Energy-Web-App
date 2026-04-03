-- Backfill: 20260403_h04_backfill_import_batches.sql
-- Phase H.4: Populate core.import_batches from:
--   1. import_runs → system/scheduled imports
--   2. smart_import_runs → user-initiated imports (project, commissioning, charter)
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_h03_create_import_batches.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_sir_projects INTEGER;
  _unmatched_users        INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_sir_projects
  FROM smart_import_runs sir
  WHERE sir.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = sir.project_id
    );
  IF _unmatched_sir_projects > 0 THEN
    RAISE WARNING '[Phase H.4 backfill] % smart_import_run(s) have a project_id not resolvable to project_instances', _unmatched_sir_projects;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_users
  FROM (
    SELECT sir.uploaded_by AS user_id FROM smart_import_runs sir WHERE sir.uploaded_by IS NOT NULL
    UNION ALL
    SELECT sir.committed_by FROM smart_import_runs sir WHERE sir.committed_by IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_users > 0 THEN
    RAISE WARNING '[Phase H.4 backfill] % distinct user_id(s) not resolvable to user_accounts; party references will remain NULL', _unmatched_users;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. import_runs → system/scheduled imports
-- -------------------------------------------------------
INSERT INTO core.import_batches (
  legacy_import_id, legacy_import_table,
  import_type, status,
  uploaded_at,
  import_data, created_at
)
SELECT
  ir.id,
  'import_runs',
  'system',
  LOWER(ir.status::TEXT),
  ir.started_at,
  jsonb_build_object(
    'trigger_type', ir.trigger_type::TEXT,
    'delta_token_used', ir.delta_token_used,
    'triggered_by', ir.triggered_by,
    'finished_at', ir.finished_at,
    'summary_json', ir.summary_json
  ),
  ir.started_at
FROM import_runs ir
ON CONFLICT (legacy_import_table, legacy_import_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. smart_import_runs → user-initiated imports
-- -------------------------------------------------------
INSERT INTO core.import_batches (
  legacy_import_id, legacy_import_table,
  import_type, project_instance_id,
  source_file_name, source_file_hash,
  status, records_attempted, records_succeeded, records_failed,
  uploaded_at, committed_at,
  import_data, created_at
)
SELECT
  sir.id,
  'smart_import_runs',
  COALESCE(sir.import_type, 'project'),
  pi.id,
  sir.source_file_name,
  sir.source_file_hash,
  LOWER(sir.status::TEXT),
  sir.records_attempted,
  sir.records_succeeded,
  sir.records_failed,
  sir.uploaded_at,
  sir.committed_at,
  jsonb_build_object(
    'template_profile_id', sir.template_profile_id,
    'summary_json', sir.summary_json,
    'project_name', sir.project_name
  ),
  sir.uploaded_at
FROM smart_import_runs sir
LEFT JOIN core.projects p ON p.legacy_project_info_id = sir.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_import_table, legacy_import_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Resolve uploaded_by and committed_by party IDs
-- -------------------------------------------------------
UPDATE core.import_batches ib
SET uploaded_by_party_id = ua.party_id
FROM smart_import_runs sir
JOIN core.user_accounts ua ON ua.legacy_user_id = sir.uploaded_by
WHERE ib.legacy_import_table = 'smart_import_runs'
  AND ib.legacy_import_id = sir.id
  AND sir.uploaded_by IS NOT NULL
  AND ib.uploaded_by_party_id IS NULL;

UPDATE core.import_batches ib
SET committed_by_party_id = ua.party_id
FROM smart_import_runs sir
JOIN core.user_accounts ua ON ua.legacy_user_id = sir.committed_by
WHERE ib.legacy_import_table = 'smart_import_runs'
  AND ib.legacy_import_id = sir.id
  AND sir.committed_by IS NOT NULL
  AND ib.committed_by_party_id IS NULL;

COMMIT;
