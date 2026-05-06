-- 20260315_multischema_reconciliation_hardening.sql
-- PR 86 hardening reconciliation checks.
-- Read-only diagnostics for integrity, duplication, lineage, and blind spots.

-- ==================================================
-- 1) Finance duplication / collision risk visibility
-- ==================================================

-- Potential duplicate revenue facts across source systems by practical business key.
SELECT 'duplicate_revenue_business_key' AS check_name,
       COALESCE(project_id::TEXT, project_name_snapshot, 'NO_PROJECT') AS project_key,
       milestone_name,
       invoice_number,
       invoice_date,
       amount_ex_vat,
       COUNT(*) AS duplicate_count,
       STRING_AGG(source_table || ':' || id::TEXT, ', ' ORDER BY source_table, id) AS rows_involved
FROM finance.revenue_lines
GROUP BY COALESCE(project_id::TEXT, project_name_snapshot, 'NO_PROJECT'), milestone_name, invoice_number, invoice_date, amount_ex_vat
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, project_key;

-- Potential duplicate cost facts across source systems by practical business key.
SELECT 'duplicate_cost_business_key' AS check_name,
       COALESCE(project_id::TEXT, project_name_snapshot, 'NO_PROJECT') AS project_key,
       counterparty_name,
       description,
       invoice_number,
       invoice_date,
       amount_ex_vat,
       COUNT(*) AS duplicate_count,
       STRING_AGG(source_table || ':' || id::TEXT, ', ' ORDER BY source_table, id) AS rows_involved
FROM finance.cost_lines
GROUP BY COALESCE(project_id::TEXT, project_name_snapshot, 'NO_PROJECT'), counterparty_name, description, invoice_number, invoice_date, amount_ex_vat
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, project_key;

-- Explicit source-lineage collisions where both normalized and program lineage are populated.
SELECT 'revenue_dual_lineage_rows' AS check_name,
       id,
       legacy_program_inflow_id,
       legacy_normalized_revenue_line_id,
       source_table
FROM finance.revenue_lines
WHERE legacy_program_inflow_id IS NOT NULL
  AND legacy_normalized_revenue_line_id IS NOT NULL
ORDER BY id;

SELECT 'cost_dual_lineage_rows' AS check_name,
       id,
       legacy_program_expense_id,
       legacy_normalized_cost_line_id,
       source_table
FROM finance.cost_lines
WHERE legacy_program_expense_id IS NOT NULL
  AND legacy_normalized_cost_line_id IS NOT NULL
ORDER BY id;

-- ==================================================
-- 2) Work item merge integrity and orphan checks
-- ==================================================

SELECT 'operational_parent_missing_after_merge' AS check_name,
       child.id AS child_work_item_id,
       child.legacy_operational_task_id,
       child.parent_work_item_id
FROM core.work_items child
LEFT JOIN core.work_items parent ON parent.id = child.parent_work_item_id
WHERE child.source_table = 'public.operational_tasks'
  AND child.parent_work_item_id IS NOT NULL
  AND parent.id IS NULL
ORDER BY child.id;

SELECT 'work_item_comment_orphans' AS check_name,
       wic.id,
       wic.source_table,
       wic.work_item_id
FROM core.work_item_comments wic
LEFT JOIN core.work_items wi ON wi.id = wic.work_item_id
WHERE wi.id IS NULL
ORDER BY wic.id;

SELECT 'work_item_attachment_orphans' AS check_name,
       wia.id,
       wia.source_table,
       wia.work_item_id
FROM core.work_item_attachments wia
LEFT JOIN core.work_items wi ON wi.id = wia.work_item_id
WHERE wi.id IS NULL
ORDER BY wia.id;

SELECT 'work_item_activity_orphans' AS check_name,
       wia.id,
       wia.source_table,
       wia.work_item_id
FROM core.work_item_activity wia
LEFT JOIN core.work_items wi ON wi.id = wia.work_item_id
WHERE wi.id IS NULL
ORDER BY wia.id;

SELECT 'work_item_watcher_orphans' AS check_name,
       wiw.id,
       wiw.work_item_id,
       wiw.watcher_name
FROM core.work_item_watchers wiw
LEFT JOIN core.work_items wi ON wi.id = wiw.work_item_id
WHERE wi.id IS NULL
ORDER BY wiw.id;

-- Watcher migration parity (expanded)
SELECT 'watcher_parity_count' AS check_name,
       (SELECT COUNT(*)
        FROM public.operational_tasks ot
        CROSS JOIN LATERAL unnest(COALESCE(ot.watchers, ARRAY[]::TEXT[])) watcher_name
        WHERE ot.deleted_at IS NULL) AS legacy_count,
       (SELECT COUNT(*)
        FROM core.work_item_watchers
        WHERE source_table = 'public.operational_tasks.watchers') AS promoted_count;

SELECT 'watcher_missing_in_core' AS check_name,
       ot.id AS legacy_operational_task_id,
       watcher_name
FROM public.operational_tasks ot
CROSS JOIN LATERAL unnest(COALESCE(ot.watchers, ARRAY[]::TEXT[])) watcher_name
LEFT JOIN core.work_item_watchers wiw
  ON wiw.work_item_id = ot.id + 1000000000
 AND wiw.watcher_name = watcher_name
 AND wiw.source_table = 'public.operational_tasks.watchers'
WHERE ot.deleted_at IS NULL
  AND wiw.id IS NULL
ORDER BY ot.id, watcher_name;

-- Blind spot check: existing work_item_* legacy tables should be represented in core
SELECT 'legacy_work_item_comments_missing_backfill' AS check_name,
       wic.id AS legacy_work_item_comment_id
FROM public.work_item_comments wic
LEFT JOIN core.work_item_comments c
  ON c.legacy_work_item_comment_id = wic.id
WHERE c.id IS NULL
ORDER BY wic.id;

SELECT 'legacy_work_item_attachments_missing_backfill' AS check_name,
       wia.id AS legacy_work_item_attachment_id
FROM public.work_item_attachments wia
LEFT JOIN core.work_item_attachments c
  ON c.legacy_work_item_attachment_id = wia.id
WHERE c.id IS NULL
ORDER BY wia.id;

SELECT 'legacy_work_item_status_history_missing_backfill' AS check_name,
       wish.id AS legacy_work_item_status_history_id
FROM public.work_item_status_history wish
LEFT JOIN core.work_item_activity c
  ON c.legacy_work_item_activity_id = wish.id
 AND c.source_table = 'public.work_item_status_history'
WHERE c.id IS NULL
ORDER BY wish.id;

-- ==================================================
-- 3) Deliverable/document split verification
-- ==================================================

SELECT 'document_versions_per_document_delta' AS check_name,
       l.legacy_deliverable_id,
       l.legacy_count,
       COALESCE(p.promoted_count, 0) AS promoted_count,
       l.legacy_count - COALESCE(p.promoted_count, 0) AS delta
FROM (
  SELECT d.id AS legacy_deliverable_id,
         (SELECT COUNT(*) FROM public.deliverable_versions dv WHERE dv.deliverable_id = d.id)
       + (SELECT COUNT(*) FROM public.deliverable_files df WHERE df.deliverable_id = d.id) AS legacy_count
  FROM public.deliverables d
) l
LEFT JOIN (
  SELECT doc.legacy_deliverable_id,
         COUNT(*) AS promoted_count
  FROM documentation.document_versions dv
  JOIN documentation.documents doc ON doc.id = dv.document_id
  GROUP BY doc.legacy_deliverable_id
) p ON p.legacy_deliverable_id = l.legacy_deliverable_id
WHERE l.legacy_count <> COALESCE(p.promoted_count, 0)
ORDER BY l.legacy_deliverable_id;

SELECT 'document_version_ambiguity' AS check_name,
       dv.document_id,
       dv.version_number,
       COUNT(*) AS rows_with_same_version,
       STRING_AGG(dv.source_table || ':' || dv.id::TEXT, ', ' ORDER BY dv.id) AS rows_involved
FROM documentation.document_versions dv
GROUP BY dv.document_id, dv.version_number
HAVING COUNT(*) > 1
ORDER BY dv.document_id, dv.version_number;

SELECT 'document_versions_missing_document' AS check_name,
       dv.id,
       dv.document_id,
       dv.source_table
FROM documentation.document_versions dv
LEFT JOIN documentation.documents d ON d.id = dv.document_id
WHERE d.id IS NULL
ORDER BY dv.id;

SELECT 'documents_linked_work_item_missing' AS check_name,
       d.id,
       d.legacy_deliverable_id,
       d.linked_work_item_id
FROM documentation.documents d
LEFT JOIN core.work_items wi ON wi.id = d.linked_work_item_id
WHERE d.linked_work_item_id IS NOT NULL
  AND wi.id IS NULL
ORDER BY d.id;

-- ==================================================
-- 4) Broader orphaned promoted reference checks
-- ==================================================

SELECT 'documents_project_orphans' AS check_name,
       d.id,
       d.project_id,
       d.source_table
FROM documentation.documents d
LEFT JOIN core.projects p ON p.id = d.project_id
WHERE d.project_id IS NOT NULL
  AND p.id IS NULL
ORDER BY d.id;

SELECT 'revenue_lines_project_orphans' AS check_name,
       rl.id,
       rl.project_id,
       rl.project_name_snapshot,
       rl.source_table
FROM finance.revenue_lines rl
LEFT JOIN core.projects p ON p.id = rl.project_id
WHERE rl.project_id IS NOT NULL
  AND p.id IS NULL
ORDER BY rl.id;

SELECT 'cost_lines_project_orphans' AS check_name,
       cl.id,
       cl.project_id,
       cl.project_name_snapshot,
       cl.source_table
FROM finance.cost_lines cl
LEFT JOIN core.projects p ON p.id = cl.project_id
WHERE cl.project_id IS NOT NULL
  AND p.id IS NULL
ORDER BY cl.id;

SELECT 'smart_import_runs_project_orphans' AS check_name,
       sir.id,
       sir.project_id,
       sir.project_name_snapshot
FROM imports.smart_import_runs sir
LEFT JOIN core.projects p ON p.id = sir.project_id
WHERE sir.project_id IS NOT NULL
  AND p.id IS NULL
ORDER BY sir.id;

-- ==================================================
-- 5) User-reference integrity checks
-- ==================================================

SELECT 'work_items_user_reference_gaps' AS check_name,
       wi.id,
       wi.source_table,
       wi.owner_user_id,
       wi.requester_user_id,
       wi.approver_user_id
FROM core.work_items wi
LEFT JOIN internal.users owner_u ON owner_u.id = wi.owner_user_id
LEFT JOIN internal.users requester_u ON requester_u.id = wi.requester_user_id
LEFT JOIN internal.users approver_u ON approver_u.id = wi.approver_user_id
WHERE (wi.owner_user_id IS NOT NULL AND owner_u.id IS NULL)
   OR (wi.requester_user_id IS NOT NULL AND requester_u.id IS NULL)
   OR (wi.approver_user_id IS NOT NULL AND approver_u.id IS NULL)
ORDER BY wi.id;

SELECT 'documents_created_by_user_gaps' AS check_name,
       d.id,
       d.created_by,
       d.source_table
FROM documentation.documents d
LEFT JOIN internal.users u ON u.id = d.created_by
WHERE d.created_by IS NOT NULL
  AND u.id IS NULL
ORDER BY d.id;

-- ==================================================
-- 6) Project-linkage gaps from project_name joins
-- ==================================================

SELECT 'project_name_join_gaps_operational_tasks' AS check_name,
       ot.id,
       ot.project_name
FROM public.operational_tasks ot
LEFT JOIN core.work_items wi
  ON wi.legacy_operational_task_id = ot.id
WHERE ot.deleted_at IS NULL
  AND ot.project_id IS NULL
  AND wi.id IS NOT NULL
  AND wi.project_id IS NULL
ORDER BY ot.id;

SELECT 'project_name_join_gaps_deliverables' AS check_name,
       d.id,
       d.project_name
FROM public.deliverables d
LEFT JOIN documentation.documents doc
  ON doc.legacy_deliverable_id = d.id
WHERE d.project_id IS NULL
  AND doc.id IS NOT NULL
  AND doc.project_id IS NULL
ORDER BY d.id;

SELECT 'project_name_join_gaps_program_inflows' AS check_name,
       pi.id,
       pi.project_name
FROM public.program_inflows pi
LEFT JOIN finance.revenue_lines rl
  ON rl.legacy_program_inflow_id = pi.id
WHERE rl.id IS NOT NULL
  AND rl.project_id IS NULL
ORDER BY pi.id;

SELECT 'project_name_join_gaps_program_expense' AS check_name,
       pe.id,
       pe.project_name
FROM public.program_expense pe
LEFT JOIN finance.cost_lines cl
  ON cl.legacy_program_expense_id = pe.id
WHERE cl.id IS NOT NULL
  AND cl.project_id IS NULL
ORDER BY pe.id;

-- ==================================================
-- 7) Soft-typed / cast-risk visibility in source data
-- ==================================================

SELECT 'program_inflows_invalid_amount_text' AS check_name,
       id,
       project_name,
       milestone_amount
FROM public.program_inflows
WHERE milestone_amount IS NOT NULL
  AND btrim(milestone_amount) <> ''
  AND btrim(milestone_amount) !~ '^-?\\d+(\\.\\d+)?$'
ORDER BY id;

SELECT 'program_expense_invalid_amount_text' AS check_name,
       id,
       project_name,
       expense_actual_total
FROM public.program_expense
WHERE expense_actual_total IS NOT NULL
  AND btrim(expense_actual_total) <> ''
  AND btrim(expense_actual_total) !~ '^-?\\d+(\\.\\d+)?$'
ORDER BY id;

SELECT 'normalized_revenue_invalid_amount_text' AS check_name,
       id,
       project_name,
       amount_ex_vat
FROM public.normalized_revenue_lines
WHERE amount_ex_vat IS NOT NULL
  AND btrim(amount_ex_vat) <> ''
  AND btrim(amount_ex_vat) !~ '^-?\\d+(\\.\\d+)?$'
ORDER BY id;

SELECT 'normalized_cost_invalid_amount_text' AS check_name,
       id,
       project_name,
       amount_ex_vat
FROM public.normalized_cost_lines
WHERE amount_ex_vat IS NOT NULL
  AND btrim(amount_ex_vat) <> ''
  AND btrim(amount_ex_vat) !~ '^-?\\d+(\\.\\d+)?$'
ORDER BY id;

-- ==================================================
-- 8) Soft-typed promoted-field validation view rollups
-- ==================================================

SELECT 'core_work_items_soft_type_issue_count' AS check_name,
       COUNT(*) AS issue_rows
FROM core.v_work_items_soft_type_issues;

SELECT 'finance_revenue_soft_type_issue_count' AS check_name,
       COUNT(*) AS issue_rows
FROM finance.v_revenue_lines_soft_type_issues;

SELECT 'finance_cost_soft_type_issue_count' AS check_name,
       COUNT(*) AS issue_rows
FROM finance.v_cost_lines_soft_type_issues;
