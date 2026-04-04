-- Reconciliation Check: Legacy vs Promoted Schema Parity
-- Run this after bridge writes are active to verify data consistency.
-- Each query returns a count. Zero = PASS. Non-zero = FAIL with details.

-- ============================================================================
-- CHECK 1: Projects — legacy project_info rows missing from core.projects
-- ============================================================================
SELECT 'CHECK_1_PROJECTS_MISSING' AS check_name,
       count(*) AS fail_count
FROM project_info pi
LEFT JOIN core.projects cp ON cp.id = pi.id
WHERE cp.id IS NULL
  AND pi.id IS NOT NULL;

-- ============================================================================
-- CHECK 2: Projects — core.projects stale vs project_info
-- (last_synced_at is older than project_info.updated_at by > 5 minutes)
-- ============================================================================
SELECT 'CHECK_2_PROJECTS_STALE' AS check_name,
       count(*) AS fail_count
FROM project_info pi
JOIN core.projects cp ON cp.id = pi.id
WHERE cp.last_synced_at < pi.updated_at - INTERVAL '5 minutes';

-- ============================================================================
-- CHECK 3: Clients — legacy clients missing from core.clients
-- ============================================================================
SELECT 'CHECK_3_CLIENTS_MISSING' AS check_name,
       count(*) AS fail_count
FROM clients c
LEFT JOIN core.clients cc ON cc.id = c.id
WHERE cc.id IS NULL
  AND c.id IS NOT NULL;

-- ============================================================================
-- CHECK 4: Cost Lines — active legacy rows missing from finance.cost_lines
-- ============================================================================
SELECT 'CHECK_4_COST_LINES_MISSING' AS check_name,
       count(*) AS fail_count
FROM normalized_cost_lines ncl
LEFT JOIN finance.cost_lines fcl ON fcl.legacy_normalized_cost_line_id = ncl.id
WHERE ncl.effective_to IS NULL
  AND fcl.id IS NULL;

-- ============================================================================
-- CHECK 5: Revenue Lines — active legacy rows missing from finance.revenue_lines
-- ============================================================================
SELECT 'CHECK_5_REVENUE_LINES_MISSING' AS check_name,
       count(*) AS fail_count
FROM normalized_revenue_lines nrl
LEFT JOIN finance.revenue_lines frl ON frl.legacy_normalized_revenue_line_id = nrl.id
WHERE nrl.effective_to IS NULL
  AND frl.id IS NULL;

-- ============================================================================
-- CHECK 6: Work Items — legacy work_items vs core.work_items count mismatch
-- (spine_view_swap should make these identical)
-- ============================================================================
SELECT 'CHECK_6_WORK_ITEMS_COUNT_MISMATCH' AS check_name,
       abs(
         (SELECT count(*) FROM public._work_items_legacy WHERE deleted_at IS NULL) -
         (SELECT count(*) FROM core.work_items WHERE deleted_at IS NULL)
       ) AS fail_count;

-- ============================================================================
-- CHECK 7: Approvals — legacy _approvals_legacy vs documentation.document_approvals
-- ============================================================================
SELECT 'CHECK_7_APPROVALS_MISSING' AS check_name,
       count(*) AS fail_count
FROM public._approvals_legacy al
LEFT JOIN documentation.document_approvals da ON da.legacy_approval_id = al.id
WHERE da.id IS NULL;

-- ============================================================================
-- CHECK 8: Deliverables — legacy _deliverables_legacy vs documentation.documents
-- ============================================================================
SELECT 'CHECK_8_DELIVERABLES_MISSING' AS check_name,
       count(*) AS fail_count
FROM public._deliverables_legacy dl
LEFT JOIN documentation.documents doc ON doc.legacy_deliverable_id = dl.id
WHERE doc.id IS NULL;

-- ============================================================================
-- CHECK 9: Change Requests — missing from finance.finance_records
-- ============================================================================
SELECT 'CHECK_9_CHANGE_REQUESTS_MISSING' AS check_name,
       count(*) AS fail_count
FROM change_requests cr
LEFT JOIN finance.finance_records fr
  ON fr.legacy_entity_table = 'public.change_requests'
  AND fr.legacy_entity_id = cr.id
WHERE cr.deleted_at IS NULL
  AND fr.id IS NULL;

-- ============================================================================
-- CHECK 10: Finance records orphan check — records pointing to non-existent legacy rows
-- ============================================================================
SELECT 'CHECK_10_FINANCE_RECORDS_ORPHANED' AS check_name,
       count(*) AS fail_count
FROM finance.finance_records fr
WHERE fr.legacy_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM normalized_cost_lines ncl WHERE ncl.id = fr.legacy_entity_id AND fr.legacy_entity_table = 'public.normalized_cost_lines'
    UNION ALL
    SELECT 1 FROM normalized_revenue_lines nrl WHERE nrl.id = fr.legacy_entity_id AND fr.legacy_entity_table = 'public.normalized_revenue_lines'
    UNION ALL
    SELECT 1 FROM change_requests cr WHERE cr.id = fr.legacy_entity_id AND fr.legacy_entity_table = 'public.change_requests'
  );
