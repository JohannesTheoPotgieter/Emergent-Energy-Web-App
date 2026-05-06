-- 20260315_multischema_hardening.sql
-- Purpose: PR 86 hardening of the additive multi-schema foundation.
-- Safety rules:
--  * Additive only: no drops of legacy objects.
--  * Lineage-first backfills.
--  * Observability-first validation views.

BEGIN;

-- ===================================================
-- 1) Tighten lineage for core.projects safely
-- ===================================================

-- Preferred mapping path: project_info.canonical_project_id -> public.projects.id.
UPDATE core.projects cp
SET legacy_projects_id = p.id,
    updated_at = GREATEST(cp.updated_at, COALESCE(p.last_updated, cp.updated_at))
FROM public.project_info pi
JOIN public.projects p ON p.id = pi.canonical_project_id
WHERE cp.id = pi.id
  AND cp.legacy_projects_id IS DISTINCT FROM p.id;

-- Fallback mapping path: exact-name match where mapping is unique and legacy_projects_id remains unset.
WITH unmatched AS (
  SELECT cp.id, cp.project_name
  FROM core.projects cp
  WHERE cp.legacy_projects_id IS NULL
), name_matches AS (
  SELECT u.id AS core_project_id,
         MIN(p.id) AS projects_id,
         COUNT(*) AS match_count
  FROM unmatched u
  JOIN public.projects p
    ON lower(btrim(p.name)) = lower(btrim(u.project_name))
  GROUP BY u.id
)
UPDATE core.projects cp
SET legacy_projects_id = nm.projects_id
FROM name_matches nm
WHERE cp.id = nm.core_project_id
  AND nm.match_count = 1
  AND cp.legacy_projects_id IS NULL;

-- ===================================================
-- 2) Fill migration blind spots from public.work_item_*
-- ===================================================

INSERT INTO core.work_item_comments (
  legacy_work_item_comment_id,
  work_item_id,
  author_user_id,
  body,
  created_at,
  source_table
)
SELECT wic.id,
       wic.work_item_id,
       wic.user_id,
       wic.content,
       wic.created_at,
       'public.work_item_comments'
FROM public.work_item_comments wic
JOIN core.work_items wi ON wi.id = wic.work_item_id
ON CONFLICT (legacy_work_item_comment_id) DO NOTHING;

INSERT INTO core.work_item_attachments (
  legacy_work_item_attachment_id,
  work_item_id,
  filename,
  url,
  uploaded_by,
  created_at,
  source_table
)
SELECT wia.id,
       wia.work_item_id,
       wia.file_name,
       wia.file_url,
       wia.uploaded_by,
       wia.created_at,
       'public.work_item_attachments'
FROM public.work_item_attachments wia
JOIN core.work_items wi ON wi.id = wia.work_item_id
ON CONFLICT (legacy_work_item_attachment_id) DO NOTHING;

INSERT INTO core.work_item_activity (
  legacy_work_item_activity_id,
  work_item_id,
  actor_id,
  action_type,
  field_name,
  old_value,
  new_value,
  created_at,
  source_table
)
SELECT wish.id,
       wish.work_item_id,
       wish.changed_by,
       'STATUS_CHANGE',
       'status',
       wish.old_status,
       wish.new_status,
       wish.changed_at,
       'public.work_item_status_history'
FROM public.work_item_status_history wish
JOIN core.work_items wi ON wi.id = wish.work_item_id
ON CONFLICT (legacy_work_item_activity_id) DO NOTHING;

-- ===================================================
-- 3) Soft-typed validation surfaces (additive views)
-- ===================================================

CREATE OR REPLACE VIEW core.v_work_items_soft_type_issues AS
SELECT wi.id,
       wi.source_table,
       wi.start_date,
       wi.due_date,
       CASE
         WHEN wi.start_date IS NOT NULL
           AND wi.start_date <> ''
           AND wi.start_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_start_date_format'
       END AS start_date_issue,
       CASE
         WHEN wi.due_date IS NOT NULL
           AND wi.due_date <> ''
           AND wi.due_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_due_date_format'
       END AS due_date_issue
FROM core.work_items wi
WHERE (wi.start_date IS NOT NULL AND wi.start_date <> '' AND wi.start_date !~ '^\\d{4}-\\d{2}-\\d{2}$')
   OR (wi.due_date IS NOT NULL AND wi.due_date <> '' AND wi.due_date !~ '^\\d{4}-\\d{2}-\\d{2}$');

CREATE OR REPLACE VIEW finance.v_revenue_lines_soft_type_issues AS
SELECT rl.id,
       rl.source_table,
       rl.project_name_snapshot,
       rl.invoice_date,
       rl.expected_payment_date,
       rl.paid_date,
       CASE
         WHEN rl.invoice_date IS NOT NULL
           AND rl.invoice_date <> ''
           AND rl.invoice_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_invoice_date_format'
       END AS invoice_date_issue,
       CASE
         WHEN rl.expected_payment_date IS NOT NULL
           AND rl.expected_payment_date <> ''
           AND rl.expected_payment_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_expected_payment_date_format'
       END AS expected_payment_date_issue,
       CASE
         WHEN rl.paid_date IS NOT NULL
           AND rl.paid_date <> ''
           AND rl.paid_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_paid_date_format'
       END AS paid_date_issue
FROM finance.revenue_lines rl
WHERE (rl.invoice_date IS NOT NULL AND rl.invoice_date <> '' AND rl.invoice_date !~ '^\\d{4}-\\d{2}-\\d{2}$')
   OR (rl.expected_payment_date IS NOT NULL AND rl.expected_payment_date <> '' AND rl.expected_payment_date !~ '^\\d{4}-\\d{2}-\\d{2}$')
   OR (rl.paid_date IS NOT NULL AND rl.paid_date <> '' AND rl.paid_date !~ '^\\d{4}-\\d{2}-\\d{2}$');

CREATE OR REPLACE VIEW finance.v_cost_lines_soft_type_issues AS
SELECT cl.id,
       cl.source_table,
       cl.project_name_snapshot,
       cl.invoice_date,
       cl.approved_date,
       cl.paid_date,
       CASE
         WHEN cl.invoice_date IS NOT NULL
           AND cl.invoice_date <> ''
           AND cl.invoice_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_invoice_date_format'
       END AS invoice_date_issue,
       CASE
         WHEN cl.approved_date IS NOT NULL
           AND cl.approved_date <> ''
           AND cl.approved_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_approved_date_format'
       END AS approved_date_issue,
       CASE
         WHEN cl.paid_date IS NOT NULL
           AND cl.paid_date <> ''
           AND cl.paid_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN 'invalid_paid_date_format'
       END AS paid_date_issue
FROM finance.cost_lines cl
WHERE (cl.invoice_date IS NOT NULL AND cl.invoice_date <> '' AND cl.invoice_date !~ '^\\d{4}-\\d{2}-\\d{2}$')
   OR (cl.approved_date IS NOT NULL AND cl.approved_date <> '' AND cl.approved_date !~ '^\\d{4}-\\d{2}-\\d{2}$')
   OR (cl.paid_date IS NOT NULL AND cl.paid_date <> '' AND cl.paid_date !~ '^\\d{4}-\\d{2}-\\d{2}$');

-- ===================================================
-- 4) Indexing/performance hygiene for traceability + reconciliation
-- ===================================================

-- core
CREATE INDEX IF NOT EXISTS idx_core_projects_legacy_projects_id ON core.projects(legacy_projects_id);
CREATE INDEX IF NOT EXISTS idx_core_projects_source_table ON core.projects(source_table);
CREATE INDEX IF NOT EXISTS idx_core_work_items_project_id ON core.work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_core_work_items_parent_work_item_id ON core.work_items(parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_core_work_items_legacy_work_items_id ON core.work_items(legacy_work_items_id);
CREATE INDEX IF NOT EXISTS idx_core_work_items_legacy_operational_task_id ON core.work_items(legacy_operational_task_id);
CREATE INDEX IF NOT EXISTS idx_core_work_items_source_table ON core.work_items(source_table);
CREATE INDEX IF NOT EXISTS idx_core_work_item_watchers_work_item_id ON core.work_item_watchers(work_item_id);
CREATE INDEX IF NOT EXISTS idx_core_work_item_watchers_source_table ON core.work_item_watchers(source_table);
CREATE INDEX IF NOT EXISTS idx_core_work_item_comments_work_item_id ON core.work_item_comments(work_item_id);
CREATE INDEX IF NOT EXISTS idx_core_work_item_comments_source_table ON core.work_item_comments(source_table);
CREATE INDEX IF NOT EXISTS idx_core_work_item_attachments_work_item_id ON core.work_item_attachments(work_item_id);
CREATE INDEX IF NOT EXISTS idx_core_work_item_attachments_source_table ON core.work_item_attachments(source_table);
CREATE INDEX IF NOT EXISTS idx_core_work_item_activity_work_item_id ON core.work_item_activity(work_item_id);
CREATE INDEX IF NOT EXISTS idx_core_work_item_activity_source_table ON core.work_item_activity(source_table);

-- documentation
CREATE INDEX IF NOT EXISTS idx_documentation_documents_project_id ON documentation.documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documentation_documents_linked_work_item_id ON documentation.documents(linked_work_item_id);
CREATE INDEX IF NOT EXISTS idx_documentation_documents_source_table ON documentation.documents(source_table);
CREATE INDEX IF NOT EXISTS idx_documentation_document_versions_document_id ON documentation.document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_documentation_document_versions_source_table ON documentation.document_versions(source_table);
CREATE INDEX IF NOT EXISTS idx_documentation_document_versions_legacy_deliverable_file_id ON documentation.document_versions(legacy_deliverable_file_id);
CREATE INDEX IF NOT EXISTS idx_documentation_document_events_document_id ON documentation.document_events(document_id);
CREATE INDEX IF NOT EXISTS idx_documentation_document_events_source_table ON documentation.document_events(source_table);

-- finance
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_project_id ON finance.revenue_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_source_table ON finance.revenue_lines(source_table);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_import_run_id ON finance.revenue_lines(import_run_id);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_project_name_snapshot ON finance.revenue_lines(project_name_snapshot);
CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_project_id ON finance.cost_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_source_table ON finance.cost_lines(source_table);
CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_import_run_id ON finance.cost_lines(import_run_id);
CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_project_name_snapshot ON finance.cost_lines(project_name_snapshot);

-- imports
CREATE INDEX IF NOT EXISTS idx_imports_smart_import_runs_project_id ON imports.smart_import_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_imports_smart_import_runs_project_name_snapshot ON imports.smart_import_runs(project_name_snapshot);
CREATE INDEX IF NOT EXISTS idx_imports_source_update_ack_source_update_request_id ON imports.source_update_acknowledgements(source_update_request_id);
CREATE INDEX IF NOT EXISTS idx_imports_data_conflicts_import_run_id ON imports.data_conflicts(import_run_id);
CREATE INDEX IF NOT EXISTS idx_imports_data_conflicts_project_id ON imports.data_conflicts(project_id);
CREATE INDEX IF NOT EXISTS idx_imports_data_conflicts_status ON imports.data_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_imports_conflict_resolutions_conflict_id ON imports.conflict_resolutions(conflict_id);

COMMIT;
