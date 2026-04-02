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

-- ============================================================================
-- SUMMARY: Review all results above. ALL HARD STOP checks must show PASS.
-- SOFT STOP checks (PF-3) may show WARN if exceptions are documented.
-- INFO checks (PF-6) require review but are not blocking.
-- ============================================================================
