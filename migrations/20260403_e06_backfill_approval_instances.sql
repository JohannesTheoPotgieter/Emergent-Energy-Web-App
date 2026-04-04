-- Backfill: 20260403_e06_backfill_approval_instances.sql
-- Phase E.6: Populate core.approval_instances from 4 source tables:
--   1. approvals → general approvals (budget, gate, procurement, HSE, etc.)
--   2. project_eng_approvals → engineering stage approvals
--   3. documentation.document_approvals → document-level approvals
--   4. approval_workflows → workflow-based approvals
-- Idempotent: ON CONFLICT (legacy_approval_table, legacy_approval_id) DO NOTHING.
-- Must run AFTER: 20260403_e05_seed_approval_rules.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings: detect unresolvable references
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_approval_projects  INTEGER;
  _unmatched_eng_stages         INTEGER;
  _unmatched_workflow_projects   INTEGER;
  _unmatched_users              INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_approval_projects
  FROM approvals a
  WHERE a.project_id IS NOT NULL
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = a.project_id
    );
  IF _unmatched_approval_projects > 0 THEN
    RAISE WARNING '[Phase E.6 backfill] % approval(s) have a project_id not resolvable to project_instances', _unmatched_approval_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_eng_stages
  FROM project_eng_approvals pea
  WHERE NOT EXISTS (
    SELECT 1 FROM project_eng_stages pes
    JOIN core.projects p ON p.legacy_project_info_id = pes.project_id
    JOIN core.project_instances pi ON pi.legacy_project_id = p.id
    WHERE pes.id = pea.project_eng_stage_id
  );
  IF _unmatched_eng_stages > 0 THEN
    RAISE WARNING '[Phase E.6 backfill] % project_eng_approval(s) have an unresolvable stage → project chain', _unmatched_eng_stages;
  END IF;

  SELECT COUNT(*) INTO _unmatched_workflow_projects
  FROM approval_workflows aw
  WHERE aw.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = aw.project_id
    );
  IF _unmatched_workflow_projects > 0 THEN
    RAISE WARNING '[Phase E.6 backfill] % approval_workflow(s) have a project_id not resolvable to project_instances', _unmatched_workflow_projects;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_users
  FROM (
    SELECT a.requested_by AS user_id FROM approvals a WHERE a.requested_by IS NOT NULL AND a.deleted_at IS NULL
    UNION ALL
    SELECT a.decided_by FROM approvals a WHERE a.decided_by IS NOT NULL AND a.deleted_at IS NULL
    UNION ALL
    SELECT pea.approver_user_id FROM project_eng_approvals pea WHERE pea.approver_user_id IS NOT NULL
    UNION ALL
    SELECT aw.requested_by_user_id FROM approval_workflows aw WHERE aw.requested_by_user_id IS NOT NULL
    UNION ALL
    SELECT aw.decided_by_user_id FROM approval_workflows aw WHERE aw.decided_by_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_users > 0 THEN
    RAISE WARNING '[Phase E.6 backfill] % distinct user_id(s) not resolvable to user_accounts; party references will remain NULL', _unmatched_users;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. General approvals (from approvals table)
-- -------------------------------------------------------
INSERT INTO core.approval_instances (
  legacy_approval_id, legacy_approval_table,
  project_instance_id, entity_type, entity_id,
  status, title, urgency,
  requested_at, decided_at, due_date, decision_note,
  approval_data, created_at, updated_at
)
SELECT
  a.id,
  'approvals',
  pi.id,
  COALESCE(a.related_entity_type, 'general'),
  a.related_entity_id,
  LOWER(a.status),
  a.title,
  a.urgency,
  a.requested_at,
  a.decided_at,
  a.due_date,
  a.decision_note,
  jsonb_build_object(
    'type', a.type,
    'description', a.description,
    'approval_type', a.approval_type,
    'approval_category', a.approval_category,
    'token', a.token,
    'expires_at', a.expires_at,
    'evidence_links', a.evidence_links
  ),
  COALESCE(a.requested_at, NOW()),
  COALESCE(a.decided_at, a.requested_at, NOW())
FROM approvals a
LEFT JOIN core.projects p ON p.legacy_project_info_id = a.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE a.deleted_at IS NULL
ON CONFLICT (legacy_approval_table, legacy_approval_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Engineering stage approvals (from project_eng_approvals)
-- -------------------------------------------------------
INSERT INTO core.approval_instances (
  legacy_approval_id, legacy_approval_table,
  project_instance_id, entity_type, entity_id,
  status, title, decided_at, decision_note,
  approval_data, created_at, updated_at
)
SELECT
  pea.id,
  'project_eng_approvals',
  pi.id,
  'eng_stage',
  pea.project_eng_stage_id,
  LOWER(pea.status),
  'Eng Stage Approval: ' || COALESCE(pea.approver_role, 'Unknown'),
  CASE WHEN LOWER(pea.status) IN ('approved', 'rejected') THEN pea.updated_at END,
  pea.comments,
  jsonb_build_object(
    'approver_role', pea.approver_role,
    'project_eng_stage_id', pea.project_eng_stage_id
  ),
  pea.created_at,
  pea.updated_at
FROM project_eng_approvals pea
JOIN project_eng_stages pes ON pes.id = pea.project_eng_stage_id
JOIN core.projects p ON p.legacy_project_info_id = pes.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_approval_table, legacy_approval_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Document approvals (from documentation.document_approvals)
-- -------------------------------------------------------
INSERT INTO core.approval_instances (
  legacy_approval_id, legacy_approval_table,
  project_instance_id, entity_type, entity_id,
  status, title, urgency, decided_at, decision_note,
  approval_data, created_at
)
SELECT
  da.id,
  'document_approvals',
  pi.id,
  COALESCE(da.related_entity_type, 'document'),
  COALESCE(da.related_entity_id, da.document_id::INTEGER),
  LOWER(da.status),
  da.title,
  da.urgency,
  da.decided_at,
  da.decision_note,
  jsonb_build_object(
    'document_id', da.document_id,
    'approval_type', da.approval_type,
    'approval_category', da.approval_category,
    'evidence_links', da.evidence_links,
    'source_table', da.source_table
  ),
  da.created_at
FROM documentation.document_approvals da
LEFT JOIN core.projects p ON p.id = da.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_approval_table, legacy_approval_id) DO NOTHING;

-- -------------------------------------------------------
-- 4. Approval workflows (from approval_workflows)
-- -------------------------------------------------------
INSERT INTO core.approval_instances (
  legacy_approval_id, legacy_approval_table,
  project_instance_id, entity_type, entity_id,
  status, title,
  approval_data, created_at, updated_at
)
SELECT
  aw.id,
  'approval_workflows',
  pi.id,
  COALESCE(aw.workflow_type, 'workflow'),
  aw.id,
  LOWER(aw.status),
  'Workflow: ' || COALESCE(aw.workflow_type, 'Unknown'),
  jsonb_build_object(
    'workflow_type', aw.workflow_type,
    'payload', aw.payload
  ),
  aw.created_at,
  aw.updated_at
FROM approval_workflows aw
LEFT JOIN core.projects p ON p.legacy_project_info_id = aw.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_approval_table, legacy_approval_id) DO NOTHING;

-- -------------------------------------------------------
-- 5. Resolve requested_by_party_id and decided_by_party_id
-- -------------------------------------------------------

-- approvals: requested_by
UPDATE core.approval_instances ai
SET requested_by_party_id = ua.party_id
FROM approvals a
JOIN core.user_accounts ua ON ua.legacy_user_id = a.requested_by
WHERE ai.legacy_approval_table = 'approvals'
  AND ai.legacy_approval_id = a.id
  AND a.requested_by IS NOT NULL
  AND ai.requested_by_party_id IS NULL;

-- approvals: decided_by
UPDATE core.approval_instances ai
SET decided_by_party_id = ua.party_id
FROM approvals a
JOIN core.user_accounts ua ON ua.legacy_user_id = a.decided_by
WHERE ai.legacy_approval_table = 'approvals'
  AND ai.legacy_approval_id = a.id
  AND a.decided_by IS NOT NULL
  AND ai.decided_by_party_id IS NULL;

-- project_eng_approvals: decided_by = approver_user_id
UPDATE core.approval_instances ai
SET decided_by_party_id = ua.party_id
FROM project_eng_approvals pea
JOIN core.user_accounts ua ON ua.legacy_user_id = pea.approver_user_id
WHERE ai.legacy_approval_table = 'project_eng_approvals'
  AND ai.legacy_approval_id = pea.id
  AND pea.approver_user_id IS NOT NULL
  AND ai.decided_by_party_id IS NULL;

-- document_approvals: requested_by
UPDATE core.approval_instances ai
SET requested_by_party_id = ua.party_id
FROM documentation.document_approvals da
JOIN core.user_accounts ua ON ua.legacy_user_id = da.requested_by_user_id
WHERE ai.legacy_approval_table = 'document_approvals'
  AND ai.legacy_approval_id = da.id
  AND da.requested_by_user_id IS NOT NULL
  AND ai.requested_by_party_id IS NULL;

-- document_approvals: decided_by = approver_user_id
UPDATE core.approval_instances ai
SET decided_by_party_id = ua.party_id
FROM documentation.document_approvals da
JOIN core.user_accounts ua ON ua.legacy_user_id = da.approver_user_id
WHERE ai.legacy_approval_table = 'document_approvals'
  AND ai.legacy_approval_id = da.id
  AND da.approver_user_id IS NOT NULL
  AND ai.decided_by_party_id IS NULL;

-- approval_workflows: requested_by
UPDATE core.approval_instances ai
SET requested_by_party_id = ua.party_id
FROM approval_workflows aw
JOIN core.user_accounts ua ON ua.legacy_user_id = aw.requested_by_user_id
WHERE ai.legacy_approval_table = 'approval_workflows'
  AND ai.legacy_approval_id = aw.id
  AND aw.requested_by_user_id IS NOT NULL
  AND ai.requested_by_party_id IS NULL;

-- approval_workflows: decided_by
UPDATE core.approval_instances ai
SET decided_by_party_id = ua.party_id
FROM approval_workflows aw
JOIN core.user_accounts ua ON ua.legacy_user_id = aw.decided_by_user_id
WHERE ai.legacy_approval_table = 'approval_workflows'
  AND ai.legacy_approval_id = aw.id
  AND aw.decided_by_user_id IS NOT NULL
  AND ai.decided_by_party_id IS NULL;

COMMIT;
