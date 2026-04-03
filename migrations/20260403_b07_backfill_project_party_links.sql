-- Backfill: 20260403_b07_backfill_project_party_links.sql
-- Phase B.4: Populate core.project_party_links from 3 sources:
--   1. core.projects (client_id, pm_user_id, pd_user_id)
--   2. project_execution_state (6 role-assignment user_id columns)
-- entity_assignments deferred to later slice.
-- Idempotent: ON CONFLICT (project_instance_id, party_id, project_role) DO NOTHING.
-- Must run AFTER: 20260403_b06_create_project_party_links.sql
BEGIN;

-- -------------------------------------------------------
-- Safety check: warn about unresolvable user_ids
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_pm INTEGER;
  _unmatched_pd INTEGER;
  _unmatched_client INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_pm
  FROM core.projects p
  WHERE p.pm_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.user_accounts ua
      JOIN core.parties pt ON pt.id = ua.party_id
      WHERE ua.legacy_user_id = p.pm_user_id
    );
  IF _unmatched_pm > 0 THEN
    RAISE WARNING '[Phase B.4 backfill] % project(s) have a pm_user_id not resolvable to a party', _unmatched_pm;
  END IF;

  SELECT COUNT(*) INTO _unmatched_pd
  FROM core.projects p
  WHERE p.pd_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.user_accounts ua
      JOIN core.parties pt ON pt.id = ua.party_id
      WHERE ua.legacy_user_id = p.pd_user_id
    );
  IF _unmatched_pd > 0 THEN
    RAISE WARNING '[Phase B.4 backfill] % project(s) have a pd_user_id not resolvable to a party', _unmatched_pd;
  END IF;

  SELECT COUNT(*) INTO _unmatched_client
  FROM core.projects p
  WHERE p.client_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.parties pt WHERE pt.legacy_client_id = p.client_id
    );
  IF _unmatched_client > 0 THEN
    RAISE WARNING '[Phase B.4 backfill] % project(s) have a client_id not resolvable to a party', _unmatched_client;
  END IF;
END $$;

-- -------------------------------------------------------
-- Step 1: client_id → role='client', is_primary=true
-- -------------------------------------------------------
INSERT INTO core.project_party_links (project_instance_id, party_id, project_role, is_primary)
SELECT
  pi.id,
  cp.id,
  'client',
  true
FROM core.projects p
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.parties cp ON cp.legacy_client_id = p.client_id
WHERE p.client_id IS NOT NULL
ON CONFLICT (project_instance_id, party_id, project_role) DO NOTHING;

-- -------------------------------------------------------
-- Step 2: pm_user_id → role='pm', is_primary=true
-- -------------------------------------------------------
INSERT INTO core.project_party_links (project_instance_id, party_id, project_role, is_primary)
SELECT
  pi.id,
  ua.party_id,
  'pm',
  true
FROM core.projects p
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.user_accounts ua ON ua.legacy_user_id = p.pm_user_id
WHERE p.pm_user_id IS NOT NULL
ON CONFLICT (project_instance_id, party_id, project_role) DO NOTHING;

-- -------------------------------------------------------
-- Step 3: pd_user_id → role='pd', is_primary=true
-- -------------------------------------------------------
INSERT INTO core.project_party_links (project_instance_id, party_id, project_role, is_primary)
SELECT
  pi.id,
  ua.party_id,
  'pd',
  true
FROM core.projects p
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.user_accounts ua ON ua.legacy_user_id = p.pd_user_id
WHERE p.pd_user_id IS NOT NULL
ON CONFLICT (project_instance_id, party_id, project_role) DO NOTHING;

-- -------------------------------------------------------
-- Step 4: project_execution_state role columns
-- Uses ROW_NUMBER to pick latest row per project (same
-- pattern as lifecycle backfill).
-- -------------------------------------------------------
WITH latest_pes AS (
  SELECT
    pes.project_id,
    pes.construction_manager_user_id,
    pes.quality_lead_user_id,
    pes.engineering_lead_user_id,
    pes.program_manager_user_id,
    pes.project_finance_user_id,
    pes.kam_user_id,
    ROW_NUMBER() OVER (
      PARTITION BY pes.project_id
      ORDER BY pes.updated_at DESC NULLS LAST,
               pes.created_at DESC NULLS LAST,
               pes.id DESC
    ) AS rn
  FROM project_execution_state pes
  WHERE pes.deleted_at IS NULL
),
pes_roles AS (
  SELECT project_id, user_id, role_code
  FROM latest_pes
  CROSS JOIN LATERAL (
    VALUES
      (construction_manager_user_id, 'construction_manager'),
      (quality_lead_user_id,         'quality_lead'),
      (engineering_lead_user_id,     'engineering_lead'),
      (program_manager_user_id,      'program_manager'),
      (project_finance_user_id,      'project_finance'),
      (kam_user_id,                  'key_accounts_manager')
  ) AS v(user_id, role_code)
  WHERE rn = 1
    AND user_id IS NOT NULL
)
INSERT INTO core.project_party_links (project_instance_id, party_id, project_role)
SELECT
  pi.id,
  ua.party_id,
  pr.role_code
FROM pes_roles pr
JOIN core.projects p ON p.legacy_project_info_id = pr.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.user_accounts ua ON ua.legacy_user_id = pr.user_id
ON CONFLICT (project_instance_id, party_id, project_role) DO NOTHING;

COMMIT;
