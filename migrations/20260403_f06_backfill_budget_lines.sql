-- Backfill: 20260403_f06_backfill_budget_lines.sql
-- Phase F.6: Populate finance.budget_lines from:
--   1. budget_baselines → project-level baselines (revenue, cost, margin, contingency)
--   2. fye_budgets → monthly budget allocations per project
-- Idempotent: ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING.
-- Must run AFTER: 20260403_f02_create_budget_lines.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_baseline_projects INTEGER;
  _unmatched_fye_projects      INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_baseline_projects
  FROM budget_baselines bb
  WHERE bb.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = bb.project_id
    );
  IF _unmatched_baseline_projects > 0 THEN
    RAISE WARNING '[Phase F.6 backfill] % budget_baseline(s) have a project_id not resolvable to project_instances', _unmatched_baseline_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_fye_projects
  FROM fye_budgets fb
  WHERE fb.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = fb.project_id
    );
  IF _unmatched_fye_projects > 0 THEN
    RAISE WARNING '[Phase F.6 backfill] % fye_budget(s) have a project_id not resolvable to project_instances', _unmatched_fye_projects;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Budget baselines — expand each baseline into 4 budget_lines
--    (revenue, cost, margin, contingency)
-- -------------------------------------------------------

-- Revenue baseline
INSERT INTO finance.budget_lines (
  legacy_budget_id, legacy_budget_table,
  project_instance_id, budget_type, category,
  amount, version, is_baseline,
  budget_data, created_at
)
SELECT
  bb.id,
  'budget_baselines_revenue',
  pi.id,
  'revenue',
  'baseline',
  bb.revenue_baseline,
  bb.version,
  COALESCE(bb.change_locked, false),
  jsonb_build_object(
    'approved_date', bb.approved_date,
    'notes', bb.notes
  ),
  bb.created_at
FROM budget_baselines bb
JOIN core.projects p ON p.legacy_project_info_id = bb.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE bb.revenue_baseline IS NOT NULL
ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING;

-- Cost baseline
INSERT INTO finance.budget_lines (
  legacy_budget_id, legacy_budget_table,
  project_instance_id, budget_type, category,
  amount, version, is_baseline,
  budget_data, created_at
)
SELECT
  bb.id,
  'budget_baselines_cost',
  pi.id,
  'cost',
  'baseline',
  bb.cos_baseline,
  bb.version,
  COALESCE(bb.change_locked, false),
  jsonb_build_object(
    'approved_date', bb.approved_date,
    'notes', bb.notes
  ),
  bb.created_at
FROM budget_baselines bb
JOIN core.projects p ON p.legacy_project_info_id = bb.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE bb.cos_baseline IS NOT NULL
ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING;

-- Margin baseline
INSERT INTO finance.budget_lines (
  legacy_budget_id, legacy_budget_table,
  project_instance_id, budget_type, category,
  amount, version, is_baseline,
  budget_data, created_at
)
SELECT
  bb.id,
  'budget_baselines_margin',
  pi.id,
  'margin',
  'baseline',
  bb.margin_baseline,
  bb.version,
  COALESCE(bb.change_locked, false),
  jsonb_build_object(
    'approved_date', bb.approved_date,
    'notes', bb.notes
  ),
  bb.created_at
FROM budget_baselines bb
JOIN core.projects p ON p.legacy_project_info_id = bb.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE bb.margin_baseline IS NOT NULL
ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING;

-- Contingency
INSERT INTO finance.budget_lines (
  legacy_budget_id, legacy_budget_table,
  project_instance_id, budget_type, category,
  amount, version, is_baseline,
  budget_data, created_at
)
SELECT
  bb.id,
  'budget_baselines_contingency',
  pi.id,
  'contingency',
  'baseline',
  bb.contingency,
  bb.version,
  COALESCE(bb.change_locked, false),
  jsonb_build_object(
    'approved_date', bb.approved_date,
    'notes', bb.notes
  ),
  bb.created_at
FROM budget_baselines bb
JOIN core.projects p ON p.legacy_project_info_id = bb.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE bb.contingency IS NOT NULL
ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Resolve approved_by_party_id on baselines
-- -------------------------------------------------------
UPDATE finance.budget_lines bl
SET approved_by_party_id = ua.party_id
FROM budget_baselines bb
JOIN core.user_accounts ua ON ua.legacy_user_id = bb.approved_by_user_id
WHERE bl.legacy_budget_table LIKE 'budget_baselines_%'
  AND bl.legacy_budget_id = bb.id
  AND bb.approved_by_user_id IS NOT NULL
  AND bl.approved_by_party_id IS NULL;

-- -------------------------------------------------------
-- 3. FYE budgets — monthly allocations
-- -------------------------------------------------------
INSERT INTO finance.budget_lines (
  legacy_budget_id, legacy_budget_table,
  project_instance_id, budget_type, category,
  period_key, amount,
  budget_data, created_at, updated_at
)
SELECT
  fb.id,
  'fye_budgets',
  pi.id,
  COALESCE(fb.budget_type, 'unclassified'),
  fb.fye,
  fb.month_key,
  fb.amount,
  jsonb_build_object(
    'fye', fb.fye,
    'project_name', fb.project_name
  ),
  fb.created_at,
  fb.updated_at
FROM fye_budgets fb
LEFT JOIN core.projects p ON p.legacy_project_info_id = fb.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_budget_table, legacy_budget_id) DO NOTHING;

COMMIT;
