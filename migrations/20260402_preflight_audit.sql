-- ============================================================================
-- PREFLIGHT AUDIT SCRIPT: Phase 1B Pre-Migration Diagnostics
-- ============================================================================
-- This is NOT a migration. It is a read-only diagnostic script.
-- Run manually BEFORE any Phase 1B migration or backfill.
-- ALL checks must return PASS before proceeding.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PF-1: Duplicate Approval Lineage Candidates
-- PASS condition: Both queries return 0 rows
-- Severity: HARD STOP
-- Detects legacy approval rows that would produce UNIQUE constraint violations
-- on legacy_approval_id during backfill.
-- ----------------------------------------------------------------------------

-- PF-1a: Duplicate IDs in public.approvals (should be impossible but verify)
SELECT 'PF-1a: Duplicate approval IDs in public.approvals' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT id, COUNT(*) AS cnt
  FROM public.approvals
  WHERE deleted_at IS NULL
  GROUP BY id
  HAVING COUNT(*) > 1
) dupes;

-- PF-1b: Existing document_approvals with duplicate legacy_approval_id
SELECT 'PF-1b: Duplicate legacy_approval_id in document_approvals' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT legacy_approval_id, COUNT(*) AS cnt
  FROM documentation.document_approvals
  WHERE legacy_approval_id IS NOT NULL
  GROUP BY legacy_approval_id
  HAVING COUNT(*) > 1
) dupes;

-- ----------------------------------------------------------------------------
-- PF-2: Orphan FK Mappings
-- PASS condition: All 4 sub-queries return 0 rows
-- Severity: HARD STOP
-- Detects promoted rows whose FKs point to legacy IDs that no longer exist.
-- ----------------------------------------------------------------------------

-- PF-2a: core.projects referencing nonexistent legacy project_execution_state
SELECT 'PF-2a: Orphan project FK mappings (projects -> project_execution_state)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM core.projects cp
WHERE cp.legacy_project_info_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.project_execution_state pes
    WHERE pes.project_id = cp.legacy_project_info_id AND pes.deleted_at IS NULL
  );

-- PF-2b: core.clients referencing nonexistent legacy clients
SELECT 'PF-2b: Orphan client FK mappings (clients -> public.clients)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM core.clients cc
WHERE cc.legacy_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.clients lc WHERE lc.id = cc.legacy_id);

-- PF-2c: documentation.documents referencing nonexistent legacy deliverables
SELECT 'PF-2c: Orphan document FK mappings (documents -> deliverables)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM documentation.documents doc
WHERE doc.legacy_deliverable_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.deliverables d WHERE d.id = doc.legacy_deliverable_id);

-- PF-2d: finance lines referencing nonexistent legacy rows
SELECT 'PF-2d: Orphan finance line FK mappings' AS check_name,
       source,
       CASE WHEN orphan_count = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       orphan_count AS violation_count
FROM (
  SELECT 'cost_lines' AS source, COUNT(*) AS orphan_count
  FROM finance.cost_lines cl
  WHERE cl.legacy_program_expense_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.program_expense pe WHERE pe.id = cl.legacy_program_expense_id)
  UNION ALL
  SELECT 'revenue_lines', COUNT(*)
  FROM finance.revenue_lines rl
  WHERE rl.legacy_program_inflow_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.program_inflows pi WHERE pi.id = rl.legacy_program_inflow_id)
) finance_orphans;

-- ----------------------------------------------------------------------------
-- PF-3: Unparseable Finance Dates
-- PASS condition: Both queries return 0 rows (or documented exceptions)
-- Severity: SOFT STOP (can proceed if exceptions are logged)
-- Detects TEXT date fields that will fail ::DATE casting during backfill.
-- ----------------------------------------------------------------------------

-- PF-3a: Cost lines with unparseable dates
SELECT 'PF-3a: Unparseable dates in finance.cost_lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END AS result,
       COUNT(*) AS violation_count
FROM finance.cost_lines cl
WHERE (cl.invoice_date IS NOT NULL AND cl.invoice_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (cl.approved_date IS NOT NULL AND cl.approved_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (cl.paid_date IS NOT NULL AND cl.paid_date !~ '^\d{4}-\d{2}-\d{2}');

-- PF-3b: Revenue lines with unparseable dates
SELECT 'PF-3b: Unparseable dates in finance.revenue_lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END AS result,
       COUNT(*) AS violation_count
FROM finance.revenue_lines rl
WHERE (rl.invoice_date IS NOT NULL AND rl.invoice_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (rl.expected_payment_date IS NOT NULL AND rl.expected_payment_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (rl.paid_date IS NOT NULL AND rl.paid_date !~ '^\d{4}-\d{2}-\d{2}');

-- ----------------------------------------------------------------------------
-- PF-4: Party Canonicalization Collisions
-- PASS condition: Both queries return 0 rows
-- Severity: HARD STOP
-- Detects counterparties whose canonical names would collide after normalization.
-- ----------------------------------------------------------------------------

-- PF-4a: Counterparty name collisions within counterparties
SELECT 'PF-4a: Counterparty name canonicalization collisions' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT LOWER(TRIM(name_canonical)) AS normalized_name, COUNT(*) AS cnt,
         ARRAY_AGG(id ORDER BY id) AS conflicting_ids
  FROM public.counterparties
  WHERE deleted_at IS NULL AND is_active = true
  GROUP BY LOWER(TRIM(name_canonical))
  HAVING COUNT(*) > 1
) collisions;

-- PF-4b: Counterparty names matching client names (party type collision)
SELECT 'PF-4b: Counterparty-client name collisions' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT cp.id AS counterparty_id, cp.name_canonical, lc.id AS client_id, lc.name AS client_name
  FROM public.counterparties cp
  JOIN public.clients lc ON LOWER(TRIM(cp.name_canonical)) = LOWER(TRIM(lc.name))
  WHERE cp.deleted_at IS NULL AND cp.is_active = true
) cross_collisions;

-- ----------------------------------------------------------------------------
-- PF-5: Unresolved Project FK Mappings
-- PASS condition: Both queries return 0 rows
-- Severity: HARD STOP
-- Detects legacy rows referencing project IDs with no core.projects entry.
-- ----------------------------------------------------------------------------

-- PF-5a: Approvals referencing projects not in core.projects
SELECT 'PF-5a: Approvals with unresolved project FK' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM public.approvals a
WHERE a.deleted_at IS NULL
  AND a.project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.projects cp WHERE cp.legacy_project_info_id = a.project_id
  );

-- PF-5b: Deliverable files whose parent deliverable's project has no core.projects entry
SELECT 'PF-5b: Deliverable files with unresolved project FK' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM public.deliverable_files df
JOIN public.deliverables d ON d.id = df.deliverable_id
WHERE NOT EXISTS (
  SELECT 1 FROM core.projects cp WHERE cp.legacy_project_info_id = d.project_id
);

-- ----------------------------------------------------------------------------
-- PF-6: Existing Promoted Rows That Collide With Backfill Assumptions
-- PASS condition: Counts documented and verified (review required, not blocking)
-- Severity: INFO
-- Detects pre-existing data that backfill scripts assume are empty.
-- ----------------------------------------------------------------------------

-- PF-6a: document_approvals already populated with legacy_approval_id
SELECT 'PF-6a: Existing legacy-mapped approvals' AS check_name,
       'INFO' AS result,
       COUNT(*) AS existing_legacy_mapped_approvals
FROM documentation.document_approvals
WHERE legacy_approval_id IS NOT NULL;

-- PF-6b: document_versions already have SharePoint fields populated
SELECT 'PF-6b: Existing SharePoint-enriched versions' AS check_name,
       'INFO' AS result,
       COUNT(*) AS existing_sharepoint_enriched_versions
FROM documentation.document_versions
WHERE legacy_deliverable_file_id IS NOT NULL AND site_id IS NOT NULL;

-- PF-6c: core.parties already has rows
SELECT 'PF-6c: Existing party rows' AS check_name,
       'INFO' AS result,
       COUNT(*) AS existing_party_rows
FROM core.parties;

-- PF-6d: finance lines already have fiscal_period_id populated
SELECT 'PF-6d: Existing fiscal period derivations' AS check_name,
       'INFO' AS result,
       source,
       already_derived
FROM (
  SELECT 'cost_lines' AS source, COUNT(*) AS already_derived
  FROM finance.cost_lines WHERE fiscal_period_id IS NOT NULL
  UNION ALL
  SELECT 'revenue_lines', COUNT(*)
  FROM finance.revenue_lines WHERE fiscal_period_id IS NOT NULL
) existing_derivations;

-- ----------------------------------------------------------------------------
-- PF-7: Orphan Legacy Files (Evidence Parity)
-- PASS condition: 0 orphan files
-- Severity: HARD STOP
-- Detects deliverable_files not flattened into document_versions during foundation.
-- ----------------------------------------------------------------------------

SELECT 'PF-7: Orphan legacy files (no document_versions representation)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM public.deliverable_files df
WHERE NOT EXISTS (
  SELECT 1 FROM documentation.document_versions dv
  WHERE dv.legacy_deliverable_file_id = df.id
);

-- ----------------------------------------------------------------------------
-- PF-8: Ambiguous Current-State Rows After Deterministic Ranking
-- PASS condition: 0 projects with ambiguous ranking (tied on all ORDER BY keys)
-- Severity: HARD STOP
-- Multiple historical rows per project_id are acceptable — the backfill uses
-- ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY updated_at DESC,
-- created_at DESC, id DESC) = 1 to pick the single latest.
-- This check detects the ONLY failure mode: rows tied on ALL tiebreaker columns,
-- meaning the ranking is non-deterministic and the "current" row is ambiguous.
-- It also reports (INFO) the count of projects with multiple rows for visibility.
-- ----------------------------------------------------------------------------

-- PF-8a: Projects with multiple active rows (INFO — not blocking, just visibility)
SELECT 'PF-8a: Projects with multiple project_execution_state rows (INFO)' AS check_name,
       'INFO' AS result,
       COUNT(*) AS projects_with_multiple_rows
FROM (
  SELECT pes.project_id, COUNT(*) AS row_count
  FROM public.project_execution_state pes
  WHERE pes.deleted_at IS NULL
  GROUP BY pes.project_id
  HAVING COUNT(*) > 1
) dup_projects;

-- PF-8b: Projects where the deterministic ranking produces a tie (HARD STOP)
-- If two rows share identical updated_at, created_at, AND id, the ROW_NUMBER()
-- is non-deterministic. In practice id is a PK so ties are impossible, but we
-- verify this explicitly.
SELECT 'PF-8b: Ambiguous current-state rows (tied ranking keys)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT pes.project_id
  FROM public.project_execution_state pes
  WHERE pes.deleted_at IS NULL
  GROUP BY pes.project_id
  HAVING COUNT(*) > 1
    AND COUNT(DISTINCT (pes.updated_at, pes.created_at, pes.id)) < COUNT(*)
) ambiguous_projects;

-- ----------------------------------------------------------------------------
-- PF-9: Opening Balance Detection and Classification Audit
-- PASS condition: All sub-queries return 0 or documented exceptions
-- Severity: SOFT STOP (PF-9a, PF-9b) — requires manual review before proceeding
--           HARD STOP (PF-9c, PF-9d) — multiple OB per project is always wrong
-- Opening-balance classification is heuristic (text-pattern matching on row_type
-- and milestone_name). This is acceptable as a first pass, but detected rows
-- MUST be reviewed by the data team before the backfill is run.
-- The backfill will flag these rows as is_opening_balance = true and exclude
-- them from fiscal_period_id derivation (period movement totals).
-- Any row NOT matched by these patterns will be treated as a normal transaction.
-- Ambiguous rows that are actually opening balances but don't match these
-- patterns will be silently miscounted as movement — review the full report.
-- ----------------------------------------------------------------------------

-- PF-9a: Cost lines with opening balance row_type (SOFT STOP — review required)
-- Classification is heuristic. Operator must verify the listed rows before
-- allowing the backfill to flag them as is_opening_balance = true.
SELECT 'PF-9a: Cost lines classified as opening balance (REVIEW REQUIRED)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'REVIEW' END AS result,
       'SOFT_STOP' AS severity,
       COUNT(*) AS opening_balance_count
FROM public.program_expense pe
WHERE LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob');

-- PF-9a detail: Full listing of all rows classified as opening balance for review
SELECT 'PF-9a-detail' AS check_name,
       pe.id, pe.project_name, pe.row_type, pe.expense_category,
       pe.expense_line_item, pe.expense_actual_total,
       pe.expense_invoiced_date
FROM public.program_expense pe
WHERE LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob')
ORDER BY pe.project_name, pe.id;

-- PF-9b: Revenue lines with opening balance milestone names (SOFT STOP — review required)
-- Classification is heuristic. Operator must verify the listed rows before
-- allowing the backfill to flag them as is_opening_balance = true.
SELECT 'PF-9b: Revenue lines classified as opening balance (REVIEW REQUIRED)' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'REVIEW' END AS result,
       'SOFT_STOP' AS severity,
       COUNT(*) AS opening_balance_count
FROM public.program_inflows pi
WHERE LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob');

-- PF-9b detail: Full listing of all revenue rows classified as opening balance
SELECT 'PF-9b-detail' AS check_name,
       pi.id, pi.project_name, pi.milestone_name, pi.milestone_amount,
       pi.invoice_raised_date
FROM public.program_inflows pi
WHERE LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob')
ORDER BY pi.project_name, pi.id;

-- PF-9c: Projects with more than one opening balance cost line (HARD STOP)
SELECT 'PF-9c: Projects with multiple opening balance cost lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       'HARD_STOP' AS severity,
       COUNT(*) AS violation_count
FROM (
  SELECT pe.project_name, COUNT(*) AS ob_count
  FROM public.program_expense pe
  WHERE LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob')
  GROUP BY pe.project_name
  HAVING COUNT(*) > 1
) multi_ob_projects;

-- PF-9d: Projects with more than one opening balance revenue line (HARD STOP)
SELECT 'PF-9d: Projects with multiple opening balance revenue lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       'HARD_STOP' AS severity,
       COUNT(*) AS violation_count
FROM (
  SELECT pi.project_name, COUNT(*) AS ob_count
  FROM public.program_inflows pi
  WHERE LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob')
  GROUP BY pi.project_name
  HAVING COUNT(*) > 1
) multi_ob_rev_projects;

-- ----------------------------------------------------------------------------
-- PF-10: Join Multiplication Detection on Finance Lines
-- PASS condition: 0 multiplied rows
-- Severity: HARD STOP
-- Detects cases where LEFT JOIN core.projects ON project_name produces multiple
-- matches, inflating promoted finance line counts. This checks if the existing
-- foundation backfill created duplicate cost/revenue lines per legacy ID.
-- ----------------------------------------------------------------------------

-- PF-10a: Cost lines with duplicate legacy_program_expense_id (should be UNIQUE but check)
SELECT 'PF-10a: Duplicate legacy_program_expense_id in cost_lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT legacy_program_expense_id, COUNT(*) AS cnt
  FROM finance.cost_lines
  WHERE legacy_program_expense_id IS NOT NULL
  GROUP BY legacy_program_expense_id
  HAVING COUNT(*) > 1
) dup_cost;

-- PF-10b: Revenue lines with duplicate legacy_program_inflow_id (should be UNIQUE but check)
SELECT 'PF-10b: Duplicate legacy_program_inflow_id in revenue_lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT legacy_program_inflow_id, COUNT(*) AS cnt
  FROM finance.revenue_lines
  WHERE legacy_program_inflow_id IS NOT NULL
  GROUP BY legacy_program_inflow_id
  HAVING COUNT(*) > 1
) dup_rev;

-- PF-10c: Project names that resolve to multiple core.projects rows
-- (would cause join multiplication in any project_name-based join)
SELECT 'PF-10c: Ambiguous project names in core.projects' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT project_name, COUNT(*) AS cnt
  FROM core.projects
  WHERE project_name IS NOT NULL
  GROUP BY project_name
  HAVING COUNT(*) > 1
) dup_project_names;

-- ----------------------------------------------------------------------------
-- PF-11: Aggregate Inflation Detection (Row Count + Amount, Per-Project + Portfolio)
-- PASS condition: Legacy and promoted totals match within tolerance at all levels
-- Severity: HARD STOP
-- Detects if joins, duplicates, or opening balance misclassification have inflated
-- row counts or financial totals in the promoted schema vs legacy source.
-- Checks both per-project granularity and portfolio-level aggregates.
-- ----------------------------------------------------------------------------

-- PF-11a: Per-project cost AMOUNT inflation (promoted vs legacy)
SELECT 'PF-11a: Per-project cost amount inflation' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_amounts
FROM (
  SELECT
    cp.id AS project_id,
    ABS(
      COALESCE(SUM(cl.amount_ex_vat), 0) -
      COALESCE((
        SELECT SUM(NULLIF(pe.expense_actual_total, '')::NUMERIC(15,2))
        FROM public.program_expense pe
        WHERE pe.project_name = cp.project_name
      ), 0)
    ) AS amount_delta
  FROM core.projects cp
  LEFT JOIN finance.cost_lines cl ON cl.project_id = cp.id
  GROUP BY cp.id, cp.project_name
  HAVING ABS(
    COALESCE(SUM(cl.amount_ex_vat), 0) -
    COALESCE((
      SELECT SUM(NULLIF(pe2.expense_actual_total, '')::NUMERIC(15,2))
      FROM public.program_expense pe2
      WHERE pe2.project_name = cp.project_name
    ), 0)
  ) > 0.50
) inflated_projects;

-- PF-11b: Per-project cost ROW COUNT inflation (promoted vs legacy)
SELECT 'PF-11b: Per-project cost row count inflation' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_row_counts
FROM (
  SELECT cp.id AS project_id,
         COUNT(cl.id) AS promoted_rows,
         COALESCE((
           SELECT COUNT(*)
           FROM public.program_expense pe
           WHERE pe.project_name = cp.project_name
         ), 0) AS legacy_rows
  FROM core.projects cp
  LEFT JOIN finance.cost_lines cl ON cl.project_id = cp.id
    AND cl.source_table = 'public.program_expense'
  GROUP BY cp.id, cp.project_name
  HAVING COUNT(cl.id) > COALESCE((
    SELECT COUNT(*) FROM public.program_expense pe2
    WHERE pe2.project_name = cp.project_name
  ), 0)
) inflated_row_counts;

-- PF-11c: Per-project revenue AMOUNT inflation (promoted vs legacy)
SELECT 'PF-11c: Per-project revenue amount inflation' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_amounts
FROM (
  SELECT
    cp.id AS project_id,
    ABS(
      COALESCE(SUM(rl.amount_ex_vat), 0) -
      COALESCE((
        SELECT SUM(NULLIF(pi.milestone_amount, '')::NUMERIC(15,2))
        FROM public.program_inflows pi
        WHERE pi.project_name = cp.project_name
      ), 0)
    ) AS amount_delta
  FROM core.projects cp
  LEFT JOIN finance.revenue_lines rl ON rl.project_id = cp.id
  GROUP BY cp.id, cp.project_name
  HAVING ABS(
    COALESCE(SUM(rl.amount_ex_vat), 0) -
    COALESCE((
      SELECT SUM(NULLIF(pi2.milestone_amount, '')::NUMERIC(15,2))
      FROM public.program_inflows pi2
      WHERE pi2.project_name = cp.project_name
    ), 0)
  ) > 0.50
) inflated_projects;

-- PF-11d: Per-project revenue ROW COUNT inflation (promoted vs legacy)
SELECT 'PF-11d: Per-project revenue row count inflation' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_row_counts
FROM (
  SELECT cp.id AS project_id,
         COUNT(rl.id) AS promoted_rows,
         COALESCE((
           SELECT COUNT(*)
           FROM public.program_inflows pi
           WHERE pi.project_name = cp.project_name
         ), 0) AS legacy_rows
  FROM core.projects cp
  LEFT JOIN finance.revenue_lines rl ON rl.project_id = cp.id
    AND rl.source_table = 'public.program_inflows'
  GROUP BY cp.id, cp.project_name
  HAVING COUNT(rl.id) > COALESCE((
    SELECT COUNT(*) FROM public.program_inflows pi2
    WHERE pi2.project_name = cp.project_name
  ), 0)
) inflated_row_counts;

-- PF-11e: Portfolio-level aggregate cost inflation (promoted vs legacy)
SELECT 'PF-11e: Portfolio-level cost aggregate inflation' AS check_name,
       CASE WHEN ABS(promoted_total - legacy_total) <= 0.50 THEN 'PASS' ELSE 'FAIL' END AS result,
       legacy_total, promoted_total,
       promoted_total - legacy_total AS delta,
       legacy_row_count, promoted_row_count,
       promoted_row_count - legacy_row_count AS row_count_delta
FROM (
  SELECT
    COALESCE(SUM(NULLIF(pe.expense_actual_total, '')::NUMERIC(15,2)), 0) AS legacy_total,
    COUNT(pe.id) AS legacy_row_count
  FROM public.program_expense pe
) legacy_costs,
(
  SELECT
    COALESCE(SUM(cl.amount_ex_vat), 0) AS promoted_total,
    COUNT(cl.id) AS promoted_row_count
  FROM finance.cost_lines cl
  WHERE cl.source_table = 'public.program_expense'
) promoted_costs;

-- PF-11f: Portfolio-level aggregate revenue inflation (promoted vs legacy)
SELECT 'PF-11f: Portfolio-level revenue aggregate inflation' AS check_name,
       CASE WHEN ABS(promoted_total - legacy_total) <= 0.50 THEN 'PASS' ELSE 'FAIL' END AS result,
       legacy_total, promoted_total,
       promoted_total - legacy_total AS delta,
       legacy_row_count, promoted_row_count,
       promoted_row_count - legacy_row_count AS row_count_delta
FROM (
  SELECT
    COALESCE(SUM(NULLIF(pi.milestone_amount, '')::NUMERIC(15,2)), 0) AS legacy_total,
    COUNT(pi.id) AS legacy_row_count
  FROM public.program_inflows pi
) legacy_rev,
(
  SELECT
    COALESCE(SUM(rl.amount_ex_vat), 0) AS promoted_total,
    COUNT(rl.id) AS promoted_row_count
  FROM finance.revenue_lines rl
  WHERE rl.source_table = 'public.program_inflows'
) promoted_rev;

-- ============================================================================
-- SUMMARY: Review all results above.
-- HARD STOP checks: PF-1, PF-2, PF-4, PF-5, PF-7, PF-8b, PF-9c, PF-9d,
--   PF-10, PF-11 — ALL must show PASS.
-- SOFT STOP checks: PF-3, PF-9a, PF-9b — require manual review and sign-off.
-- INFO checks: PF-6, PF-8a — require review but are not blocking.
-- ============================================================================
