-- ============================================================
-- Database Integrity Hardening (QA Sweep 01 fixes)
-- Addresses all structural gaps found in the integrity audit:
--   1. CHECK constraints for temporal columns
--   2. CHECK constraints for import snapshot integrity
--   3. NOT NULL on financial table project_id columns
--   4. NOT NULL on work_items.created_by
--   5. Drop legacy task_id columns from task sub-tables
--   6. Backfill 1:1 child rows (project_execution_state, project_settings)
--   7. Backfill dashboard_project_metrics rows
-- ============================================================

-- ── 1. Temporal CHECK constraints (effective_to >= effective_from) ────────

DO $$ BEGIN
  ALTER TABLE program_expense
    ADD CONSTRAINT chk_program_expense_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE program_inflows
    ADD CONSTRAINT chk_program_inflows_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE cashflow_points
    ADD CONSTRAINT chk_cashflow_points_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE finance_revenue_monthly
    ADD CONSTRAINT chk_finance_revenue_monthly_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE finance_cos_monthly
    ADD CONSTRAINT chk_finance_cos_monthly_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE project_revenue_summary
    ADD CONSTRAINT chk_project_revenue_summary_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE normalized_cost_lines
    ADD CONSTRAINT chk_normalized_cost_lines_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE normalized_revenue_lines
    ADD CONSTRAINT chk_normalized_revenue_lines_temporal
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Import snapshot CHECK constraints ─────────────────────────────────
-- Every row with source = 'imported_edited' must retain its import_snapshot.

DO $$ BEGIN
  ALTER TABLE program_expense
    ADD CONSTRAINT chk_program_expense_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE program_inflows
    ADD CONSTRAINT chk_program_inflows_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE project_plan
    ADD CONSTRAINT chk_project_plan_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE cashflow_points
    ADD CONSTRAINT chk_cashflow_points_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE finance_revenue_monthly
    ADD CONSTRAINT chk_finance_revenue_monthly_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE finance_cos_monthly
    ADD CONSTRAINT chk_finance_cos_monthly_snapshot
    CHECK (source <> 'imported_edited' OR import_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. Make financial table project_id NOT NULL ──────────────────────────
-- Backfill NULLs first by matching on project_name, then enforce NOT NULL.

-- Backfill program_expense
UPDATE program_expense pe
SET project_id = pi.id
FROM project_info pi
WHERE pe.project_id IS NULL
  AND LOWER(TRIM(pe.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill program_inflows
UPDATE program_inflows pf
SET project_id = pi.id
FROM project_info pi
WHERE pf.project_id IS NULL
  AND LOWER(TRIM(pf.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill project_plan
UPDATE project_plan pp
SET project_id = pi.id
FROM project_info pi
WHERE pp.project_id IS NULL
  AND LOWER(TRIM(pp.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill cashflow_points
UPDATE cashflow_points cp
SET project_id = pi.id
FROM project_info pi
WHERE cp.project_id IS NULL
  AND LOWER(TRIM(cp.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill finance_revenue_monthly
UPDATE finance_revenue_monthly frm
SET project_id = pi.id
FROM project_info pi
WHERE frm.project_id IS NULL
  AND LOWER(TRIM(frm.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill finance_cos_monthly
UPDATE finance_cos_monthly fcm
SET project_id = pi.id
FROM project_info pi
WHERE fcm.project_id IS NULL
  AND LOWER(TRIM(fcm.project_name)) = LOWER(TRIM(pi.project_name));

-- Backfill project_revenue_summary
UPDATE project_revenue_summary prs
SET project_id = pi.id
FROM project_info pi
WHERE prs.project_id IS NULL
  AND LOWER(TRIM(prs.project_name)) = LOWER(TRIM(pi.project_name));

-- Delete any remaining orphans that cannot be linked (no matching project_name)
DELETE FROM program_expense WHERE project_id IS NULL;
DELETE FROM program_inflows WHERE project_id IS NULL;
DELETE FROM project_plan WHERE project_id IS NULL;
DELETE FROM cashflow_points WHERE project_id IS NULL;
DELETE FROM finance_revenue_monthly WHERE project_id IS NULL;
DELETE FROM finance_cos_monthly WHERE project_id IS NULL;
DELETE FROM project_revenue_summary WHERE project_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE program_expense ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE program_inflows ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE project_plan ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE cashflow_points ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE finance_revenue_monthly ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE finance_cos_monthly ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE project_revenue_summary ALTER COLUMN project_id SET NOT NULL;

-- ── 4. Make work_items.created_by NOT NULL ───────────────────────────────
-- Backfill NULLs to owner_user_id or fallback to user id=1
UPDATE work_items
SET created_by = COALESCE(owner_user_id, 1)
WHERE created_by IS NULL;

ALTER TABLE work_items ALTER COLUMN created_by SET NOT NULL;

-- ── 5. Drop legacy task_id columns from task sub-tables ──────────────────
-- These reference the dropped operational_tasks table and have no FK constraint.

ALTER TABLE task_comments DROP COLUMN IF EXISTS task_id;
ALTER TABLE task_checklists DROP COLUMN IF EXISTS task_id;
ALTER TABLE task_attachments DROP COLUMN IF EXISTS task_id;
ALTER TABLE task_deliverables DROP COLUMN IF EXISTS task_id;
ALTER TABLE task_activity_log DROP COLUMN IF EXISTS task_id;
ALTER TABLE task_watchers DROP COLUMN IF EXISTS task_id;

-- Make work_item_id NOT NULL now that task_id is removed
-- First backfill any NULLs (shouldn't exist, but safety)
DELETE FROM task_comments WHERE work_item_id IS NULL;
DELETE FROM task_checklists WHERE work_item_id IS NULL;
DELETE FROM task_attachments WHERE work_item_id IS NULL;
DELETE FROM task_deliverables WHERE work_item_id IS NULL;
DELETE FROM task_activity_log WHERE work_item_id IS NULL;
DELETE FROM task_watchers WHERE work_item_id IS NULL;

ALTER TABLE task_comments ALTER COLUMN work_item_id SET NOT NULL;
ALTER TABLE task_checklists ALTER COLUMN work_item_id SET NOT NULL;
ALTER TABLE task_attachments ALTER COLUMN work_item_id SET NOT NULL;
ALTER TABLE task_deliverables ALTER COLUMN work_item_id SET NOT NULL;
ALTER TABLE task_activity_log ALTER COLUMN work_item_id SET NOT NULL;
ALTER TABLE task_watchers ALTER COLUMN work_item_id SET NOT NULL;

-- ── 6. Backfill missing 1:1 child rows ──────────────────────────────────

INSERT INTO project_execution_state (project_id)
SELECT pi.id FROM project_info pi
LEFT JOIN project_execution_state pes ON pi.id = pes.project_id
WHERE pes.id IS NULL
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO project_settings (project_id)
SELECT pi.id FROM project_info pi
LEFT JOIN project_settings ps ON pi.id = ps.project_id
WHERE ps.id IS NULL
ON CONFLICT (project_id) DO NOTHING;

-- ── 7. Backfill missing dashboard_project_metrics rows ───────────────────
-- Creates placeholder rows with zeroed metrics for any project missing them.
-- The refresh service will populate real values on next cycle.

INSERT INTO dashboard_project_metrics (
  project_id, project_name, pm, pd, phase, rag_status,
  contract_value, total_revenue, received_revenue, outstanding_revenue,
  total_cost, paid_cost, outstanding_cost,
  task_count, tasks_completed, tasks_in_progress, tasks_overdue, tasks_active,
  open_warnings
)
SELECT
  pi.id,
  pi.project_name,
  pi.pm,
  pi.pd,
  pes.phase,
  pes.rag_status,
  pi.contract_value,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
FROM project_info pi
LEFT JOIN project_execution_state pes ON pi.id = pes.project_id
LEFT JOIN dashboard_project_metrics dpm ON pi.id = dpm.project_id
WHERE dpm.id IS NULL
ON CONFLICT (project_id) DO NOTHING;
