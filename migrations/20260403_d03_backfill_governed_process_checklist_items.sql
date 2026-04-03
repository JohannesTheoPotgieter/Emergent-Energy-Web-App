-- Backfill: 20260403_d03_backfill_governed_process_checklist_items.sql
-- Phase D.3: Populate core.governed_process_checklist_items from:
--   1. handover_checklist_items → linked to pd_to_pm_handover governed processes
--   2. project_stage_requirements → linked to phase_gate_review governed processes
--      (latest per valid project only, skip NOT_STARTED items)
-- Idempotent: WHERE NOT EXISTS guards.
-- Must run AFTER: 20260403_d02_backfill_governed_processes.sql
BEGIN;

-- -------------------------------------------------------
-- 1. Handover checklist items → pd_to_pm_handover processes
-- handover_checklist_items → handover_packs → project (via handover pack's project)
-- -------------------------------------------------------
INSERT INTO core.governed_process_checklist_items (
  governed_process_id, legacy_item_id, legacy_item_table,
  title, category, status, blocks_gate,
  completed_at, evidence_url, notes, sort_order,
  created_at
)
SELECT
  gp.id,
  hci.id,
  'handover_checklist_items',
  hci.item_name,
  hci.category,
  LOWER(hci.status),
  hci.required,
  hci.completed_date,
  hci.evidence_link,
  hci.notes,
  hci.id,
  COALESCE(hci.completed_date, NOW())
FROM handover_checklist_items hci
JOIN handover_packs hp ON hp.id = hci.handover_pack_id
JOIN core.projects p ON p.legacy_project_info_id = hp.project_id
JOIN core.governed_processes gp
  ON gp.legacy_entity_table = 'project_pd_pm_handover'
  AND gp.project_instance_id = (
    SELECT pi.id FROM core.project_instances pi WHERE pi.legacy_project_id = p.id
  )
WHERE NOT EXISTS (
  SELECT 1 FROM core.governed_process_checklist_items gpci
  WHERE gpci.legacy_item_table = 'handover_checklist_items'
    AND gpci.legacy_item_id = hci.id
);

-- -------------------------------------------------------
-- 2. Stage requirements → phase_gate_review or standalone processes
-- Only backfill items that have been touched (status != 'NOT_STARTED')
-- Latest stage instance per project (via project_stage_instances)
-- -------------------------------------------------------

-- First, create governed_processes for stage instances that don't have gate evaluations
-- (so checklist items have a parent process to link to)
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, phase_definition_id, status, title,
  started_at, created_at, updated_at
)
SELECT
  psi.id,
  'project_stage_instances',
  pi.id,
  'stage_gate',
  pd.id,
  LOWER(psi.stage_status),
  'Stage: ' || psi.stage_code,
  psi.started_at,
  psi.created_at,
  psi.updated_at
FROM project_stage_instances psi
JOIN core.projects p ON p.legacy_project_info_id = psi.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
LEFT JOIN core.phase_definitions pd ON pd.code = psi.stage_code
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- Resolve owner for stage instances
UPDATE core.governed_processes gp
SET owner_party_id = ua.party_id
FROM project_stage_instances psi
JOIN core.user_accounts ua ON ua.legacy_user_id = psi.stage_owner_user_id
WHERE gp.legacy_entity_table = 'project_stage_instances'
  AND gp.legacy_entity_id = psi.id
  AND psi.stage_owner_user_id IS NOT NULL
  AND gp.owner_party_id IS NULL;

-- Now backfill checklist items from stage requirements
INSERT INTO core.governed_process_checklist_items (
  governed_process_id, legacy_item_id, legacy_item_table,
  item_code, title, category, status, blocks_gate,
  owner_party_id, completed_at, evidence_url, notes, sort_order,
  created_at, updated_at
)
SELECT
  gp.id,
  psr.id,
  'project_stage_requirements',
  psr.item_code,
  psr.item_name,
  psr.department,
  LOWER(psr.status),
  psr.blocks_gate,
  ua.party_id,
  psr.completed_date,
  psr.evidence_url,
  psr.notes,
  psr.id,
  psr.created_at,
  psr.updated_at
FROM project_stage_requirements psr
JOIN project_stage_instances psi ON psi.id = psr.stage_instance_id
JOIN core.governed_processes gp
  ON gp.legacy_entity_table = 'project_stage_instances'
  AND gp.legacy_entity_id = psi.id
LEFT JOIN core.user_accounts ua ON ua.legacy_user_id = psr.owner_user_id
WHERE psr.status <> 'NOT_STARTED'
  AND NOT EXISTS (
    SELECT 1 FROM core.governed_process_checklist_items gpci
    WHERE gpci.legacy_item_table = 'project_stage_requirements'
      AND gpci.legacy_item_id = psr.id
  );

COMMIT;
