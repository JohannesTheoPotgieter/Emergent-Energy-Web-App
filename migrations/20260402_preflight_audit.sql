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
-- PF-8: Duplicate Latest/Current Project Execution State Per Project
-- PASS condition: 0 projects with multiple active rows
-- Severity: HARD STOP
-- Detects projects that have more than one non-deleted project_execution_state
-- row. The backfill uses ROW_NUMBER() to pick the latest, but duplicates should
-- be flagged so the data team can verify correctness.
-- ----------------------------------------------------------------------------

SELECT 'PF-8: Duplicate project_execution_state rows per project' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT pes.project_id, COUNT(*) AS row_count
  FROM public.project_execution_state pes
  WHERE pes.deleted_at IS NULL
  GROUP BY pes.project_id
  HAVING COUNT(*) > 1
) dup_projects;

-- ----------------------------------------------------------------------------
-- PF-9: Opening Balance Rows That Would Be Included in Movement Totals
-- PASS condition: All sub-queries return 0 or documented exceptions
-- Severity: HARD STOP
-- Detects finance rows that look like opening balances but would be treated as
-- normal transactions if not explicitly flagged.
-- ----------------------------------------------------------------------------

-- PF-9a: Cost lines with opening balance row_type
SELECT 'PF-9a: Cost lines with opening balance row_type' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END AS result,
       COUNT(*) AS opening_balance_count
FROM public.program_expense pe
WHERE LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob');

-- PF-9b: Revenue lines with opening balance milestone names
SELECT 'PF-9b: Revenue lines with opening balance milestone names' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END AS result,
       COUNT(*) AS opening_balance_count
FROM public.program_inflows pi
WHERE LOWER(COALESCE(pi.milestone_name, '')) IN ('opening balance', 'balance forward', 'brought forward', 'ob');

-- PF-9c: Projects with more than one opening balance cost line
-- (only one opening balance per project should exist)
SELECT 'PF-9c: Projects with multiple opening balance cost lines' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT pe.project_name, COUNT(*) AS ob_count
  FROM public.program_expense pe
  WHERE LOWER(COALESCE(pe.row_type, '')) IN ('opening_balance', 'opening balance', 'balance_forward', 'brought_forward', 'ob')
  GROUP BY pe.project_name
  HAVING COUNT(*) > 1
) multi_ob_projects;

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
-- PF-11: Aggregate Inflation Detection
-- PASS condition: Legacy and promoted per-project totals match within tolerance
-- Severity: HARD STOP
-- Detects if joins or duplicates have inflated project-level finance totals
-- in the promoted schema compared to legacy source.
-- ----------------------------------------------------------------------------

-- PF-11a: Per-project cost total comparison (promoted vs legacy)
SELECT 'PF-11a: Per-project cost total inflation check' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_totals
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
    ) AS delta
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

-- PF-11b: Per-project revenue total comparison (promoted vs legacy)
SELECT 'PF-11b: Per-project revenue total inflation check' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS projects_with_inflated_totals
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
    ) AS delta
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

-- ============================================================================
-- SUMMARY: Review all results above. ALL HARD STOP checks must show PASS.
-- SOFT STOP checks (PF-3) may show WARN if exceptions are documented.
-- INFO checks (PF-6) require review but are not blocking.
-- WARN checks (PF-9a, PF-9b) flag opening balances for classification.
-- ============================================================================
