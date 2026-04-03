-- Backfill: 20260403_g04_backfill_activity_log.sql
-- Phase G.4: Populate core.activity_log from:
--   1. domain_events → operational domain events
--   2. deliverable_events → deliverable status changes
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_g03_create_activity_audit_logs.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_de_projects  INTEGER;
  _unmatched_del_events   INTEGER;
  _unmatched_users        INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_de_projects
  FROM domain_events de
  WHERE de.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = de.project_id
    );
  IF _unmatched_de_projects > 0 THEN
    RAISE WARNING '[Phase G.4 backfill] % domain_event(s) have a project_id not resolvable to project_instances', _unmatched_de_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_del_events
  FROM deliverable_events dev
  WHERE NOT EXISTS (
    SELECT 1 FROM core.deliverable_instances di
    WHERE di.legacy_deliverable_table = 'deliverables'
      AND di.legacy_deliverable_id = dev.deliverable_id
  );
  IF _unmatched_del_events > 0 THEN
    RAISE WARNING '[Phase G.4 backfill] % deliverable_event(s) reference deliverables not in deliverable_instances', _unmatched_del_events;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_users
  FROM (
    SELECT de.triggered_by AS user_id FROM domain_events de WHERE de.triggered_by IS NOT NULL
    UNION ALL
    SELECT dev.actor_user_id FROM deliverable_events dev WHERE dev.actor_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_users > 0 THEN
    RAISE WARNING '[Phase G.4 backfill] % distinct user_id(s) not resolvable to user_accounts; actor_party_id will remain NULL', _unmatched_users;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. domain_events → activity_log
-- -------------------------------------------------------
INSERT INTO core.activity_log (
  legacy_event_id, legacy_event_table,
  event_type, aggregate_type, aggregate_id,
  project_instance_id, payload,
  created_at, processed_at
)
SELECT
  de.id,
  'domain_events',
  de.event_type,
  de.aggregate_type,
  de.aggregate_id,
  pi.id,
  COALESCE(de.payload, '{}'::jsonb),
  de.created_at,
  de.processed_at
FROM domain_events de
LEFT JOIN core.projects p ON p.legacy_project_info_id = de.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_event_table, legacy_event_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. deliverable_events → activity_log
-- -------------------------------------------------------
INSERT INTO core.activity_log (
  legacy_event_id, legacy_event_table,
  event_type, aggregate_type, aggregate_id,
  project_instance_id, payload,
  created_at
)
SELECT
  dev.id,
  'deliverable_events',
  dev.event_type,
  'deliverable',
  di.id,
  di.project_instance_id,
  jsonb_build_object(
    'from_status', dev.from_status,
    'to_status', dev.to_status,
    'feedback_text', dev.feedback_text,
    'legacy_deliverable_id', dev.deliverable_id
  ),
  dev.created_at
FROM deliverable_events dev
LEFT JOIN core.deliverable_instances di
  ON di.legacy_deliverable_table = 'deliverables'
  AND di.legacy_deliverable_id = dev.deliverable_id
ON CONFLICT (legacy_event_table, legacy_event_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Resolve actor_party_id
-- -------------------------------------------------------

-- domain_events: triggered_by
UPDATE core.activity_log al
SET actor_party_id = ua.party_id
FROM domain_events de
JOIN core.user_accounts ua ON ua.legacy_user_id = de.triggered_by
WHERE al.legacy_event_table = 'domain_events'
  AND al.legacy_event_id = de.id
  AND de.triggered_by IS NOT NULL
  AND al.actor_party_id IS NULL;

-- deliverable_events: actor_user_id
UPDATE core.activity_log al
SET actor_party_id = ua.party_id
FROM deliverable_events dev
JOIN core.user_accounts ua ON ua.legacy_user_id = dev.actor_user_id
WHERE al.legacy_event_table = 'deliverable_events'
  AND al.legacy_event_id = dev.id
  AND dev.actor_user_id IS NOT NULL
  AND al.actor_party_id IS NULL;

COMMIT;
