-- 20260316_promoted_read_preparation.sql
-- Purpose: PR 87 staged promoted-read preparation (additive, reversible, comparison-first).
-- Safety rules:
--  * No legacy drops/deletes.
--  * No broad cutover.
--  * Read compatibility and observability only.

BEGIN;

-- -------------------------------------------------
-- 1) Compatibility read surfaces (core -> legacy shape)
-- -------------------------------------------------

CREATE OR REPLACE VIEW core.v_clients_legacy_compat AS
SELECT
  c.id,
  c.name,
  c.client_code AS client_id,
  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at,
  c.source_table
FROM core.clients c;

CREATE OR REPLACE VIEW core.v_portfolios_legacy_compat AS
SELECT
  p.id,
  p.name,
  p.description,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.source_table
FROM core.portfolios p;

CREATE OR REPLACE VIEW core.v_project_portfolio_assignments_legacy_compat AS
SELECT
  a.id,
  a.project_id,
  a.portfolio_id,
  a.assigned_by,
  a.assigned_at,
  a.source_table
FROM core.project_portfolio_assignments a;

-- -------------------------------------------------
-- 2) Side-by-side comparison views (legacy vs promoted)
-- -------------------------------------------------

CREATE OR REPLACE VIEW core.v_projects_promoted_vs_legacy AS
SELECT
  COALESCE(pi.id, cp.id) AS id,
  pi.id IS NULL AS exists_in_promoted_only,
  cp.id IS NULL AS exists_in_legacy_only,
  pi.project_name AS legacy_project_name,
  cp.project_name AS promoted_project_name,
  pi.client_id AS legacy_client_id,
  cp.client_id AS promoted_client_id,
  pi.phase AS legacy_phase,
  cp.phase AS promoted_phase,
  (pi.project_name IS DISTINCT FROM cp.project_name) AS project_name_mismatch,
  (pi.client_id IS DISTINCT FROM cp.client_id) AS client_id_mismatch,
  (pi.phase IS DISTINCT FROM cp.phase) AS phase_mismatch
FROM public.project_info pi
FULL OUTER JOIN core.projects cp ON cp.id = pi.id;

CREATE OR REPLACE VIEW core.v_clients_promoted_vs_legacy AS
SELECT
  COALESCE(l.id, p.id) AS id,
  l.id IS NULL AS exists_in_promoted_only,
  p.id IS NULL AS exists_in_legacy_only,
  l.name AS legacy_name,
  p.name AS promoted_name,
  l.client_id AS legacy_client_code,
  p.client_code AS promoted_client_code,
  (l.name IS DISTINCT FROM p.name) AS name_mismatch,
  (l.client_id IS DISTINCT FROM p.client_code) AS client_code_mismatch
FROM public.clients l
FULL OUTER JOIN core.clients p ON p.id = l.id;

CREATE OR REPLACE VIEW core.v_portfolios_promoted_vs_legacy AS
SELECT
  COALESCE(l.id, p.id) AS id,
  l.id IS NULL AS exists_in_promoted_only,
  p.id IS NULL AS exists_in_legacy_only,
  l.name AS legacy_name,
  p.name AS promoted_name,
  l.description AS legacy_description,
  p.description AS promoted_description,
  (l.name IS DISTINCT FROM p.name) AS name_mismatch,
  (l.description IS DISTINCT FROM p.description) AS description_mismatch
FROM public.portfolios l
FULL OUTER JOIN core.portfolios p ON p.id = l.id;

CREATE OR REPLACE VIEW core.v_project_portfolio_assignments_promoted_vs_legacy AS
WITH legacy AS (
  SELECT project_id, portfolio_id
  FROM public.project_portfolio_assignments
), promoted AS (
  SELECT project_id, portfolio_id
  FROM core.project_portfolio_assignments
)
SELECT
  COALESCE(l.project_id, p.project_id) AS project_id,
  COALESCE(l.portfolio_id, p.portfolio_id) AS portfolio_id,
  l.project_id IS NULL AS exists_in_promoted_only,
  p.project_id IS NULL AS exists_in_legacy_only
FROM legacy l
FULL OUTER JOIN promoted p
  ON p.project_id = l.project_id
 AND p.portfolio_id = l.portfolio_id;

CREATE OR REPLACE VIEW core.v_work_item_counts_promoted_vs_legacy AS
WITH legacy AS (
  SELECT project_id, COUNT(*)::INTEGER AS legacy_count
  FROM public.work_items
  WHERE deleted_at IS NULL
  GROUP BY project_id
), promoted AS (
  SELECT project_id, COUNT(*)::INTEGER AS promoted_count
  FROM core.work_items
  WHERE source_table = 'public.work_items'
  GROUP BY project_id
)
SELECT
  COALESCE(l.project_id, p.project_id) AS project_id,
  COALESCE(l.legacy_count, 0) AS legacy_count,
  COALESCE(p.promoted_count, 0) AS promoted_count,
  COALESCE(l.legacy_count, 0) - COALESCE(p.promoted_count, 0) AS delta
FROM legacy l
FULL OUTER JOIN promoted p ON p.project_id = l.project_id;

-- -------------------------------------------------
-- 3) Cutover readiness summary
-- -------------------------------------------------

CREATE OR REPLACE VIEW core.v_promoted_read_cutover_blockers AS
SELECT
  'projects'::TEXT AS domain,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE exists_in_promoted_only
         OR exists_in_legacy_only
         OR project_name_mismatch
         OR client_id_mismatch
         OR phase_mismatch
    ) = 0 THEN 'ready'
    WHEN COUNT(*) FILTER (WHERE exists_in_legacy_only) > 0 THEN 'blocked'
    ELSE 'partial'
  END AS status,
  COUNT(*) FILTER (WHERE exists_in_legacy_only) AS missing_in_promoted,
  COUNT(*) FILTER (WHERE exists_in_promoted_only) AS extra_in_promoted,
  COUNT(*) FILTER (WHERE project_name_mismatch OR client_id_mismatch OR phase_mismatch) AS field_mismatch,
  'core.v_projects_promoted_vs_legacy'::TEXT AS evidence_source
FROM core.v_projects_promoted_vs_legacy

UNION ALL

SELECT
  'clients'::TEXT AS domain,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE exists_in_promoted_only
         OR exists_in_legacy_only
         OR name_mismatch
         OR client_code_mismatch
    ) = 0 THEN 'ready'
    WHEN COUNT(*) FILTER (WHERE exists_in_legacy_only) > 0 THEN 'blocked'
    ELSE 'partial'
  END AS status,
  COUNT(*) FILTER (WHERE exists_in_legacy_only) AS missing_in_promoted,
  COUNT(*) FILTER (WHERE exists_in_promoted_only) AS extra_in_promoted,
  COUNT(*) FILTER (WHERE name_mismatch OR client_code_mismatch) AS field_mismatch,
  'core.v_clients_promoted_vs_legacy'::TEXT AS evidence_source
FROM core.v_clients_promoted_vs_legacy

UNION ALL

SELECT
  'portfolios'::TEXT AS domain,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE exists_in_promoted_only
         OR exists_in_legacy_only
         OR name_mismatch
         OR description_mismatch
    ) = 0 THEN 'ready'
    WHEN COUNT(*) FILTER (WHERE exists_in_legacy_only) > 0 THEN 'blocked'
    ELSE 'partial'
  END AS status,
  COUNT(*) FILTER (WHERE exists_in_legacy_only) AS missing_in_promoted,
  COUNT(*) FILTER (WHERE exists_in_promoted_only) AS extra_in_promoted,
  COUNT(*) FILTER (WHERE name_mismatch OR description_mismatch) AS field_mismatch,
  'core.v_portfolios_promoted_vs_legacy'::TEXT AS evidence_source
FROM core.v_portfolios_promoted_vs_legacy

UNION ALL

SELECT
  'project_portfolio_assignments'::TEXT AS domain,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE exists_in_promoted_only OR exists_in_legacy_only
    ) = 0 THEN 'ready'
    WHEN COUNT(*) FILTER (WHERE exists_in_legacy_only) > 0 THEN 'blocked'
    ELSE 'partial'
  END AS status,
  COUNT(*) FILTER (WHERE exists_in_legacy_only) AS missing_in_promoted,
  COUNT(*) FILTER (WHERE exists_in_promoted_only) AS extra_in_promoted,
  0::BIGINT AS field_mismatch,
  'core.v_project_portfolio_assignments_promoted_vs_legacy'::TEXT AS evidence_source
FROM core.v_project_portfolio_assignments_promoted_vs_legacy

UNION ALL

SELECT
  'work_item_counts'::TEXT AS domain,
  CASE
    WHEN COUNT(*) FILTER (WHERE delta <> 0) = 0 THEN 'ready'
    ELSE 'partial'
  END AS status,
  COUNT(*) FILTER (WHERE legacy_count > 0 AND promoted_count = 0) AS missing_in_promoted,
  COUNT(*) FILTER (WHERE promoted_count > 0 AND legacy_count = 0) AS extra_in_promoted,
  COUNT(*) FILTER (WHERE delta <> 0) AS field_mismatch,
  'core.v_work_item_counts_promoted_vs_legacy'::TEXT AS evidence_source
FROM core.v_work_item_counts_promoted_vs_legacy;

COMMIT;
