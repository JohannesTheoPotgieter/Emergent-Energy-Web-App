-- Backfill: 20260403_g05_backfill_audit_log.sql
-- Phase G.5: Populate core.audit_log from:
--   1. audit_events → compliance audit records (UI, IMPORT, SETTINGS, DOCS, SYSTEM)
--   2. audit_trail → before/after change snapshots
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_g03_create_activity_audit_logs.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_ae_projects  INTEGER;
  _unmatched_at_users     INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_ae_projects
  FROM audit_events ae
  WHERE ae.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = ae.project_id
    );
  IF _unmatched_ae_projects > 0 THEN
    RAISE WARNING '[Phase G.5 backfill] % audit_event(s) have a project_id not resolvable to project_instances', _unmatched_ae_projects;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_at_users
  FROM (
    SELECT ae.user_id AS user_id FROM audit_events ae WHERE ae.user_id IS NOT NULL
    UNION ALL
    SELECT at2.actor_user_id FROM audit_trail at2 WHERE at2.actor_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_at_users > 0 THEN
    RAISE WARNING '[Phase G.5 backfill] % distinct user_id(s) not resolvable to user_accounts; actor_party_id will remain NULL', _unmatched_at_users;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. audit_events → audit_log
-- -------------------------------------------------------
INSERT INTO core.audit_log (
  legacy_audit_id, legacy_audit_table,
  actor_role, source,
  entity_type, entity_id, action,
  changes, project_instance_id,
  correlation_id, ip_address, request_path, request_method,
  created_at
)
SELECT
  ae.id,
  'audit_events',
  ae.actor_role,
  ae.source::TEXT,
  ae.entity_type,
  ae.entity_id,
  ae.action,
  COALESCE(ae.changes_json, '{}'::jsonb),
  pi.id,
  ae.correlation_id,
  ae.ip_address,
  ae.request_path,
  ae.request_method,
  ae.created_at
FROM audit_events ae
LEFT JOIN core.projects p ON p.legacy_project_info_id = ae.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_audit_table, legacy_audit_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. audit_trail → audit_log (before/after snapshots)
-- -------------------------------------------------------
INSERT INTO core.audit_log (
  legacy_audit_id, legacy_audit_table,
  entity_type, entity_id, action,
  changes, created_at
)
SELECT
  at2.id,
  'audit_trail',
  at2.entity_type,
  at2.entity_id::TEXT,
  at2.action,
  jsonb_build_object(
    'before', at2.before_value,
    'after', at2.after_value
  ),
  at2.created_at
FROM audit_trail at2
ON CONFLICT (legacy_audit_table, legacy_audit_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Resolve actor_party_id
-- -------------------------------------------------------

-- audit_events: user_id
UPDATE core.audit_log al
SET actor_party_id = ua.party_id
FROM audit_events ae
JOIN core.user_accounts ua ON ua.legacy_user_id = ae.user_id
WHERE al.legacy_audit_table = 'audit_events'
  AND al.legacy_audit_id = ae.id
  AND ae.user_id IS NOT NULL
  AND al.actor_party_id IS NULL;

-- audit_trail: actor_user_id
UPDATE core.audit_log al
SET actor_party_id = ua.party_id
FROM audit_trail at2
JOIN core.user_accounts ua ON ua.legacy_user_id = at2.actor_user_id
WHERE al.legacy_audit_table = 'audit_trail'
  AND al.legacy_audit_id = at2.id
  AND at2.actor_user_id IS NOT NULL
  AND al.actor_party_id IS NULL;

COMMIT;
