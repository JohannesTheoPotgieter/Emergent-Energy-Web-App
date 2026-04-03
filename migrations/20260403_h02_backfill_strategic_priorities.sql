-- Backfill: 20260403_h02_backfill_strategic_priorities.sql
-- Phase H.2: Populate core.strategic_priorities from mytool_company_priorities
-- and core.strategic_priority_links from priority_projects.
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_h01_create_strategic_priorities.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_linked_projects INTEGER;
  _unmatched_pp_projects     INTEGER;
  _unmatched_users           INTEGER;
  _orphaned_parents          INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_linked_projects
  FROM mytool_company_priorities mcp
  WHERE mcp.linked_project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = mcp.linked_project_id
    );
  IF _unmatched_linked_projects > 0 THEN
    RAISE WARNING '[Phase H.2 backfill] % priority(ies) have a linked_project_id not resolvable to project_instances', _unmatched_linked_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_pp_projects
  FROM priority_projects pp
  WHERE NOT EXISTS (
    SELECT 1 FROM core.projects p
    JOIN core.project_instances pi ON pi.legacy_project_id = p.id
    WHERE p.legacy_project_info_id = pp.project_id
  );
  IF _unmatched_pp_projects > 0 THEN
    RAISE WARNING '[Phase H.2 backfill] % priority_project link(s) have a project_id not resolvable to project_instances', _unmatched_pp_projects;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_users
  FROM (
    SELECT mcp.owner_user_id AS user_id FROM mytool_company_priorities mcp WHERE mcp.owner_user_id IS NOT NULL
    UNION ALL
    SELECT mcp.accountable_exec_id FROM mytool_company_priorities mcp WHERE mcp.accountable_exec_id IS NOT NULL
    UNION ALL
    SELECT mcp.assigned_user_id FROM mytool_company_priorities mcp WHERE mcp.assigned_user_id IS NOT NULL
    UNION ALL
    SELECT pp.linked_by FROM priority_projects pp WHERE pp.linked_by IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_users > 0 THEN
    RAISE WARNING '[Phase H.2 backfill] % distinct user_id(s) not resolvable to user_accounts; party references will remain NULL', _unmatched_users;
  END IF;

  SELECT COUNT(*) INTO _orphaned_parents
  FROM mytool_company_priorities mcp
  WHERE mcp.parent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM mytool_company_priorities parent WHERE parent.id = mcp.parent_id
    );
  IF _orphaned_parents > 0 THEN
    RAISE WARNING '[Phase H.2 backfill] % priority(ies) reference non-existent parent_id; parent will remain NULL', _orphaned_parents;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Insert priorities (parent_id left NULL initially)
-- -------------------------------------------------------
INSERT INTO core.strategic_priorities (
  legacy_priority_id, title, description, department,
  horizon, severity, status, priority_rank, scope,
  fiscal_year, target_start_date, target_outcome,
  definition_of_done, due_date,
  manual_health, manual_progress,
  escalated, escalated_at, escalation_reason,
  sort_order,
  priority_data, created_at, updated_at
)
SELECT
  mcp.id,
  mcp.title,
  mcp.description,
  COALESCE(mcp.department_key, mcp.department),
  mcp.horizon::TEXT,
  mcp.severity::TEXT,
  COALESCE(mcp.status::TEXT, 'active'),
  mcp.priority_rank,
  mcp.scope::TEXT,
  NULL,
  mcp.target_start_date,
  mcp.target_outcome,
  mcp.definition_of_done,
  mcp.due_date,
  mcp.manual_health,
  mcp.manual_progress,
  COALESCE(mcp.escalated, false),
  mcp.escalated_at,
  mcp.escalation_reason,
  COALESCE(mcp.sort_order, 0),
  jsonb_build_object(
    'assigned_to', mcp.assigned_to,
    'next_action', mcp.next_action,
    'support', mcp.support,
    'owner_role', mcp.owner_role,
    'linked_task_id', mcp.linked_task_id,
    'linked_task_type', mcp.linked_task_type,
    'linked_project_name', mcp.linked_project_name
  ),
  mcp.created_at,
  mcp.updated_at
FROM mytool_company_priorities mcp
ON CONFLICT (legacy_priority_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Resolve parent_id (self-referential)
-- -------------------------------------------------------
UPDATE core.strategic_priorities sp
SET parent_id = parent_sp.id
FROM mytool_company_priorities mcp
JOIN core.strategic_priorities parent_sp ON parent_sp.legacy_priority_id = mcp.parent_id
WHERE sp.legacy_priority_id = mcp.id
  AND mcp.parent_id IS NOT NULL
  AND sp.parent_id IS NULL;

-- -------------------------------------------------------
-- 3. Resolve owner, accountable, assigned party IDs
-- -------------------------------------------------------
UPDATE core.strategic_priorities sp
SET owner_party_id = ua.party_id
FROM mytool_company_priorities mcp
JOIN core.user_accounts ua ON ua.legacy_user_id = mcp.owner_user_id
WHERE sp.legacy_priority_id = mcp.id
  AND mcp.owner_user_id IS NOT NULL
  AND sp.owner_party_id IS NULL;

UPDATE core.strategic_priorities sp
SET accountable_party_id = ua.party_id
FROM mytool_company_priorities mcp
JOIN core.user_accounts ua ON ua.legacy_user_id = mcp.accountable_exec_id
WHERE sp.legacy_priority_id = mcp.id
  AND mcp.accountable_exec_id IS NOT NULL
  AND sp.accountable_party_id IS NULL;

UPDATE core.strategic_priorities sp
SET assigned_party_id = ua.party_id
FROM mytool_company_priorities mcp
JOIN core.user_accounts ua ON ua.legacy_user_id = mcp.assigned_user_id
WHERE sp.legacy_priority_id = mcp.id
  AND mcp.assigned_user_id IS NOT NULL
  AND sp.assigned_party_id IS NULL;

-- -------------------------------------------------------
-- 4. Create priority_links from priority_projects
-- -------------------------------------------------------
INSERT INTO core.strategic_priority_links (
  strategic_priority_id, entity_type, entity_id, created_at
)
SELECT
  sp.id,
  'project',
  pi.id,
  pp.linked_at
FROM priority_projects pp
JOIN core.strategic_priorities sp ON sp.legacy_priority_id = pp.priority_id
JOIN core.projects p ON p.legacy_project_info_id = pp.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (strategic_priority_id, entity_type, entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 5. Resolve linked_by_party_id on links
-- -------------------------------------------------------
UPDATE core.strategic_priority_links spl
SET linked_by_party_id = ua.party_id
FROM priority_projects pp
JOIN core.strategic_priorities sp ON sp.legacy_priority_id = pp.priority_id
JOIN core.projects p ON p.legacy_project_info_id = pp.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
JOIN core.user_accounts ua ON ua.legacy_user_id = pp.linked_by
WHERE spl.strategic_priority_id = sp.id
  AND spl.entity_type = 'project'
  AND spl.entity_id = pi.id
  AND pp.linked_by IS NOT NULL
  AND spl.linked_by_party_id IS NULL;

COMMIT;
