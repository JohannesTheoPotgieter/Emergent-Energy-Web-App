-- 20260314_multischema_reconciliation.sql
-- Read-only reconciliation checks for staged cutover readiness.

-- 1) Project master counts + key mismatches
WITH legacy AS (
  SELECT COUNT(*) AS cnt FROM public.project_info
), promoted AS (
  SELECT COUNT(*) AS cnt FROM core.projects
)
SELECT 'projects_count' AS check_name, legacy.cnt AS legacy_count, promoted.cnt AS promoted_count,
       (legacy.cnt - promoted.cnt) AS delta
FROM legacy, promoted;

SELECT 'projects_missing_in_core' AS check_name, pi.id AS legacy_id, pi.project_name
FROM public.project_info pi
LEFT JOIN core.projects cp ON cp.legacy_project_info_id = pi.id
WHERE cp.id IS NULL
ORDER BY pi.id;

-- 2) Work item merge integrity
SELECT 'work_items_operational_tasks_count' AS check_name,
       (SELECT COUNT(*) FROM public.operational_tasks WHERE deleted_at IS NULL) AS legacy_count,
       (SELECT COUNT(*) FROM core.work_items WHERE source_table = 'public.operational_tasks') AS promoted_count;

SELECT 'work_items_comments_count' AS check_name,
       (SELECT COUNT(*) FROM public.task_comments) AS legacy_count,
       (SELECT COUNT(*) FROM core.work_item_comments WHERE source_table = 'public.task_comments') AS promoted_count;

SELECT 'work_items_attachments_count' AS check_name,
       (SELECT COUNT(*) FROM public.task_attachments) AS legacy_count,
       (SELECT COUNT(*) FROM core.work_item_attachments WHERE source_table = 'public.task_attachments') AS promoted_count;

SELECT 'work_items_activity_count' AS check_name,
       (SELECT COUNT(*) FROM public.task_activity_log) AS legacy_count,
       (SELECT COUNT(*) FROM core.work_item_activity WHERE source_table = 'public.task_activity_log') AS promoted_count;

SELECT 'orphan_work_item_comments' AS check_name, wic.id
FROM core.work_item_comments wic
LEFT JOIN core.work_items wi ON wi.id = wic.work_item_id
WHERE wi.id IS NULL
ORDER BY wic.id;

-- 3) Finance totals by project/month
SELECT 'finance_revenue_total_by_project' AS check_name,
       l.project_name,
       l.legacy_total,
       p.promoted_total,
       (COALESCE(l.legacy_total, 0) - COALESCE(p.promoted_total, 0)) AS delta
FROM (
  SELECT project_name, SUM(NULLIF(milestone_amount, '')::NUMERIC(15,2)) AS legacy_total
  FROM public.program_inflows
  GROUP BY project_name
) l
FULL OUTER JOIN (
  SELECT project_name_snapshot AS project_name, SUM(amount_ex_vat) AS promoted_total
  FROM finance.revenue_lines
  WHERE source_table = 'public.program_inflows'
  GROUP BY project_name_snapshot
) p USING(project_name)
WHERE ABS(COALESCE(l.legacy_total, 0) - COALESCE(p.promoted_total, 0)) > 0.01
ORDER BY project_name;

SELECT 'finance_cost_total_by_project' AS check_name,
       l.project_name,
       l.legacy_total,
       p.promoted_total,
       (COALESCE(l.legacy_total, 0) - COALESCE(p.promoted_total, 0)) AS delta
FROM (
  SELECT project_name, SUM(NULLIF(expense_actual_total, '')::NUMERIC(15,2)) AS legacy_total
  FROM public.program_expense
  GROUP BY project_name
) l
FULL OUTER JOIN (
  SELECT project_name_snapshot AS project_name, SUM(amount_ex_vat) AS promoted_total
  FROM finance.cost_lines
  WHERE source_table = 'public.program_expense'
  GROUP BY project_name_snapshot
) p USING(project_name)
WHERE ABS(COALESCE(l.legacy_total, 0) - COALESCE(p.promoted_total, 0)) > 0.01
ORDER BY project_name;

-- 4) Deliverable/document lifecycle preservation
SELECT 'documents_from_deliverables_count' AS check_name,
       (SELECT COUNT(*) FROM public.deliverables) AS legacy_count,
       (SELECT COUNT(*) FROM documentation.documents WHERE source_table = 'public.deliverables') AS promoted_count;

SELECT 'document_versions_from_legacy_count' AS check_name,
       (SELECT COUNT(*) FROM public.deliverable_versions) + (SELECT COUNT(*) FROM public.deliverable_files) AS legacy_count,
       (SELECT COUNT(*) FROM documentation.document_versions
         WHERE source_table IN ('public.deliverable_versions', 'public.deliverable_files')) AS promoted_count;

SELECT 'document_events_from_legacy_count' AS check_name,
       (SELECT COUNT(*) FROM public.deliverable_events) AS legacy_count,
       (SELECT COUNT(*) FROM documentation.document_events WHERE source_table = 'public.deliverable_events') AS promoted_count;

-- 5) Import lineage preservation
SELECT 'import_runs_count' AS check_name,
       (SELECT COUNT(*) FROM public.import_runs) AS legacy_count,
       (SELECT COUNT(*) FROM imports.import_runs) AS promoted_count;

SELECT 'smart_import_runs_count' AS check_name,
       (SELECT COUNT(*) FROM public.smart_import_runs) AS legacy_count,
       (SELECT COUNT(*) FROM imports.smart_import_runs) AS promoted_count;

-- 6) User/role/permission preservation (initial user identity check)
SELECT 'users_count' AS check_name,
       (SELECT COUNT(*) FROM public.users) AS legacy_count,
       (SELECT COUNT(*) FROM internal.users) AS promoted_count;

SELECT 'users_missing_in_internal' AS check_name, u.id, u.username
FROM public.users u
LEFT JOIN internal.users iu ON iu.legacy_id = u.id
WHERE iu.id IS NULL
ORDER BY u.id;

-- 7) unresolved conflicts reporting (new governance layer)
SELECT 'open_data_conflicts' AS check_name, COUNT(*) AS open_conflicts
FROM imports.data_conflicts
WHERE status <> 'resolved';
