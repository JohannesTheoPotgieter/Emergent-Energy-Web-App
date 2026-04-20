-- 20260314_multischema_foundation.sql
-- Purpose: Additive, migration-first multi-schema foundation with lineage-preserving backfill.
-- Safety rules:
--  * No legacy table is dropped/renamed.
--  * All new objects are additive.
--  * Backfill uses legacy IDs for traceability and idempotent upserts.

BEGIN;

-- =========================
-- Phase B.1: schema shells
-- =========================
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS internal;
CREATE SCHEMA IF NOT EXISTS project_development;
CREATE SCHEMA IF NOT EXISTS engineering;
CREATE SCHEMA IF NOT EXISTS quality;
CREATE SCHEMA IF NOT EXISTS project_management;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS imports;
CREATE SCHEMA IF NOT EXISTS documentation;
CREATE SCHEMA IF NOT EXISTS personal;

-- =============================================
-- Phase B.2/B.3: core/internal/imports/finance
-- =============================================

CREATE TABLE IF NOT EXISTS internal.users (
  id INTEGER PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  microsoft_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL DEFAULT 'public.users'
);

CREATE TABLE IF NOT EXISTS core.clients (
  id INTEGER PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  client_code TEXT,
  name TEXT NOT NULL,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL DEFAULT 'public.clients'
);

CREATE TABLE IF NOT EXISTS core.projects (
  id INTEGER PRIMARY KEY,
  legacy_project_info_id INTEGER UNIQUE,
  legacy_projects_id INTEGER,
  project_name TEXT NOT NULL UNIQUE,
  project_code TEXT,
  client_id INTEGER REFERENCES core.clients(id),
  phase TEXT,
  rag_status TEXT,
  rag_comment TEXT,
  execution_gate_status TEXT,
  execution_gate_reason TEXT,
  archived_status TEXT,
  pm_user_id INTEGER,
  pd_user_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL DEFAULT 'public.project_info'
);

CREATE TABLE IF NOT EXISTS core.portfolios (
  id INTEGER PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL DEFAULT 'public.portfolios'
);

CREATE TABLE IF NOT EXISTS core.project_portfolio_assignments (
  id INTEGER PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  project_id INTEGER NOT NULL REFERENCES core.projects(id),
  portfolio_id INTEGER NOT NULL REFERENCES core.portfolios(id),
  assigned_by INTEGER,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL DEFAULT 'public.project_portfolio_assignments'
);

CREATE TABLE IF NOT EXISTS core.work_items (
  id INTEGER PRIMARY KEY,
  legacy_work_items_id INTEGER UNIQUE,
  legacy_operational_task_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  parent_work_item_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  phase TEXT,
  owner_user_id INTEGER,
  requester_user_id INTEGER,
  approver_user_id INTEGER,
  due_date TEXT,
  start_date TEXT,
  completed_at TIMESTAMP,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_domain TEXT,
  external_source TEXT,
  external_task_id TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL,
  CONSTRAINT fk_core_work_items_parent FOREIGN KEY (parent_work_item_id) REFERENCES core.work_items(id)
);

CREATE TABLE IF NOT EXISTS core.work_item_comments (
  id BIGSERIAL PRIMARY KEY,
  legacy_task_comment_id INTEGER UNIQUE,
  legacy_work_item_comment_id INTEGER UNIQUE,
  work_item_id INTEGER NOT NULL REFERENCES core.work_items(id) ON DELETE CASCADE,
  author_user_id INTEGER,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.work_item_attachments (
  id BIGSERIAL PRIMARY KEY,
  legacy_task_attachment_id INTEGER UNIQUE,
  legacy_work_item_attachment_id INTEGER UNIQUE,
  work_item_id INTEGER NOT NULL REFERENCES core.work_items(id) ON DELETE CASCADE,
  filename TEXT,
  url TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.work_item_activity (
  id BIGSERIAL PRIMARY KEY,
  legacy_task_activity_id INTEGER UNIQUE,
  legacy_work_item_activity_id INTEGER UNIQUE,
  work_item_id INTEGER NOT NULL REFERENCES core.work_items(id) ON DELETE CASCADE,
  actor_id INTEGER,
  action_type TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.work_item_watchers (
  id BIGSERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES core.work_items(id) ON DELETE CASCADE,
  watcher_user_id INTEGER,
  watcher_name TEXT,
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(work_item_id, watcher_user_id, watcher_name)
);

CREATE TABLE IF NOT EXISTS documentation.documents (
  id BIGSERIAL PRIMARY KEY,
  legacy_deliverable_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  linked_work_item_id INTEGER REFERENCES core.work_items(id),
  title TEXT NOT NULL,
  document_type TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentation.document_versions (
  id BIGSERIAL PRIMARY KEY,
  legacy_deliverable_version_id INTEGER UNIQUE,
  legacy_deliverable_file_id INTEGER,
  document_id BIGINT NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  storage_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL,
  UNIQUE(document_id, version_number)
);

CREATE TABLE IF NOT EXISTS documentation.document_events (
  id BIGSERIAL PRIMARY KEY,
  legacy_deliverable_event_id INTEGER UNIQUE,
  document_id BIGINT NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_table TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentation.document_approvals (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  approver_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  decided_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentation.document_transmissions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  sent_by_user_id INTEGER,
  recipient_user_id INTEGER,
  recipient_address TEXT,
  channel TEXT NOT NULL DEFAULT 'app',
  transmission_status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documentation.document_views (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  viewer_user_id INTEGER,
  view_type TEXT NOT NULL DEFAULT 'view',
  viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS finance.revenue_lines (
  id BIGSERIAL PRIMARY KEY,
  legacy_program_inflow_id INTEGER UNIQUE,
  legacy_normalized_revenue_line_id INTEGER,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  milestone_name TEXT,
  amount_ex_vat NUMERIC(15,2),
  invoice_number TEXT,
  invoice_date TEXT,
  expected_payment_date TEXT,
  paid_date TEXT,
  status TEXT,
  import_run_id INTEGER,
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.cost_lines (
  id BIGSERIAL PRIMARY KEY,
  legacy_program_expense_id INTEGER UNIQUE,
  legacy_normalized_cost_line_id INTEGER,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  counterparty_name TEXT,
  description TEXT,
  amount_ex_vat NUMERIC(15,2),
  invoice_number TEXT,
  invoice_date TEXT,
  approved_date TEXT,
  paid_date TEXT,
  status TEXT,
  import_run_id INTEGER,
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.project_revenue_summaries (
  id BIGSERIAL PRIMARY KEY,
  legacy_project_revenue_summary_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  planned_revenue NUMERIC(15,2),
  planned_expenditure NUMERIC(15,2),
  planned_profit NUMERIC(15,2),
  actual_revenue NUMERIC(15,2),
  actual_expenditure NUMERIC(15,2),
  actual_profit NUMERIC(15,2),
  captured_at TIMESTAMP,
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS imports.import_runs (
  id INTEGER PRIMARY KEY,
  legacy_import_run_id INTEGER UNIQUE,
  trigger_type TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  status TEXT,
  triggered_by TEXT,
  summary_json JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.import_runs'
);

CREATE TABLE IF NOT EXISTS imports.smart_import_runs (
  id INTEGER PRIMARY KEY,
  legacy_smart_import_run_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  uploaded_by INTEGER,
  uploaded_at TIMESTAMP,
  source_file_name TEXT,
  source_file_hash TEXT,
  status TEXT,
  summary_json JSONB,
  committed_at TIMESTAMP,
  committed_by INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.smart_import_runs'
);

CREATE TABLE IF NOT EXISTS imports.source_update_requests (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES core.projects(id),
  source_system TEXT NOT NULL DEFAULT 'excel_tracker',
  source_artifact_ref TEXT,
  requested_by_user_id INTEGER,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  due_by TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS imports.source_update_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  source_update_request_id BIGINT NOT NULL REFERENCES imports.source_update_requests(id) ON DELETE CASCADE,
  acknowledged_by_user_id INTEGER NOT NULL,
  acknowledged_role TEXT NOT NULL,
  acknowledged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledgement_status TEXT NOT NULL DEFAULT 'completed',
  comments TEXT,
  UNIQUE(source_update_request_id, acknowledged_by_user_id, acknowledged_role)
);

CREATE TABLE IF NOT EXISTS imports.data_conflicts (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES core.projects(id),
  import_run_id INTEGER REFERENCES imports.smart_import_runs(id),
  conflict_scope TEXT NOT NULL,
  source_entity TEXT NOT NULL,
  source_record_key TEXT NOT NULL,
  app_entity TEXT NOT NULL,
  app_record_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source_value TEXT,
  app_value TEXT,
  severity TEXT NOT NULL DEFAULT 'warning',
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS imports.conflict_resolutions (
  id BIGSERIAL PRIMARY KEY,
  conflict_id BIGINT NOT NULL REFERENCES imports.data_conflicts(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  decided_by_user_id INTEGER,
  decided_at TIMESTAMP NOT NULL DEFAULT NOW(),
  rationale TEXT,
  applied_change_set_id BIGINT,
  UNIQUE(conflict_id)
);

-- =====================================
-- Phase C: additive compatibility views
-- =====================================
CREATE OR REPLACE VIEW core.v_projects_legacy_compat AS
SELECT p.id,
       p.project_name,
       p.phase,
       p.client_id,
       p.rag_status,
       p.rag_comment,
       p.execution_gate_status,
       p.execution_gate_reason,
       p.updated_at,
       p.legacy_project_info_id
FROM core.projects p;

CREATE OR REPLACE VIEW core.v_work_items_legacy_compat AS
SELECT w.id,
       w.project_id,
       w.title,
       w.status,
       w.priority,
       w.phase,
       w.owner_user_id,
       w.requester_user_id,
       w.approver_user_id,
       w.start_date,
       w.due_date,
       w.completed_at,
       w.created_at,
       w.updated_at,
       w.legacy_operational_task_id,
       w.legacy_work_items_id
FROM core.work_items w;

-- ==========================
-- Phase C: lineage backfill
-- ==========================

INSERT INTO internal.users (id, legacy_id, username, email, name, role, microsoft_id, created_at, updated_at)
SELECT u.id, u.id, u.username, u.email, u.name, u.role, u.microsoft_id, u.created_at, COALESCE(u.created_at, NOW())
FROM public.users u
ON CONFLICT (id) DO UPDATE
SET username = EXCLUDED.username,
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    microsoft_id = EXCLUDED.microsoft_id,
    updated_at = NOW();

INSERT INTO core.clients (id, legacy_id, client_code, name, created_by, updated_by, created_at, updated_at)
SELECT c.id, c.id, c.client_id, c.name, c.created_by, c.updated_by, c.created_at, c.updated_at
FROM public.clients c
ON CONFLICT (id) DO UPDATE
SET client_code = EXCLUDED.client_code,
    name = EXCLUDED.name,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

INSERT INTO core.projects (
  id, legacy_project_info_id, project_name, client_id, phase, rag_status, rag_comment,
  execution_gate_status, execution_gate_reason, archived_status, pm_user_id, pd_user_id, created_at, updated_at
)
SELECT pi.id, pi.id, pi.project_name, pi.client_id, pi.phase, pi.rag_status, pi.rag_comment,
       pi.execution_gate_status, pi.execution_gate_reason, pi.archived_status, pi.pm_user_id, pi.pd_user_id,
       NOW(), pi.updated_at
FROM public.project_info pi
ON CONFLICT (id) DO UPDATE
SET project_name = EXCLUDED.project_name,
    client_id = EXCLUDED.client_id,
    phase = EXCLUDED.phase,
    rag_status = EXCLUDED.rag_status,
    rag_comment = EXCLUDED.rag_comment,
    execution_gate_status = EXCLUDED.execution_gate_status,
    execution_gate_reason = EXCLUDED.execution_gate_reason,
    archived_status = EXCLUDED.archived_status,
    pm_user_id = EXCLUDED.pm_user_id,
    pd_user_id = EXCLUDED.pd_user_id,
    updated_at = EXCLUDED.updated_at;

INSERT INTO core.portfolios (id, legacy_id, name, description, created_by, created_at, updated_at)
SELECT p.id, p.id, p.name, p.description, p.created_by, p.created_at, p.updated_at
FROM public.portfolios p
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = EXCLUDED.updated_at;

INSERT INTO core.project_portfolio_assignments (id, legacy_id, project_id, portfolio_id, assigned_by, assigned_at)
SELECT ppa.id, ppa.id, ppa.project_id, ppa.portfolio_id, ppa.assigned_by, ppa.assigned_at
FROM public.project_portfolio_assignments ppa
ON CONFLICT (id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    portfolio_id = EXCLUDED.portfolio_id,
    assigned_by = EXCLUDED.assigned_by,
    assigned_at = EXCLUDED.assigned_at;

-- Backfill existing public.work_items first
INSERT INTO core.work_items (
  id, legacy_work_items_id, project_id, parent_work_item_id, title, description, status, priority, phase,
  owner_user_id, requester_user_id, approver_user_id, due_date, start_date, completed_at,
  sort_order, source_domain, external_source, external_task_id, created_by, created_at, updated_at, source_table
)
SELECT wi.id, wi.id, wi.project_id, wi.parent_work_item_id, wi.title, wi.description, wi.status, wi.priority, wi.phase,
       wi.owner_user_id, wi.requester_user_id, wi.approver_user_id, wi.due_date, wi.start_date, wi.completed_at,
       wi.sort_order, wi.domain, wi.external_source, wi.external_task_id, wi.created_by, wi.created_at, wi.updated_at,
       'public.work_items'
FROM public.work_items wi
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    phase = EXCLUDED.phase,
    owner_user_id = EXCLUDED.owner_user_id,
    due_date = EXCLUDED.due_date,
    updated_at = EXCLUDED.updated_at;

-- Merge operational_tasks into same core.work_items identity space without overwriting existing work_items IDs
INSERT INTO core.work_items (
  id, legacy_operational_task_id, project_id, parent_work_item_id, title, description, status, priority, phase,
  owner_user_id, requester_user_id, approver_user_id, due_date, start_date, completed_at,
  sort_order, source_domain, external_source, external_task_id, created_by, created_at, updated_at, source_table
)
SELECT ot.id + 1000000000,
       ot.id,
       COALESCE(ot.project_id, cp.id),
       CASE WHEN ot.parent_task_id IS NULL THEN NULL ELSE ot.parent_task_id + 1000000000 END,
       ot.title,
       ot.description,
       ot.status,
       ot.priority,
       ot.phase,
       ot.owner_user_id,
       ot.requester_user_id,
       ot.approver_user_id,
       ot.due_date,
       ot.start_date,
       ot.completed_at,
       ot.sort_order,
       ot.domain,
       ot.external_source,
       ot.external_task_id,
       ot.created_by,
       ot.created_at,
       ot.updated_at,
       'public.operational_tasks'
FROM public.operational_tasks ot
LEFT JOIN core.projects cp ON cp.project_name = ot.project_name
WHERE ot.deleted_at IS NULL
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    due_date = EXCLUDED.due_date,
    updated_at = EXCLUDED.updated_at;

INSERT INTO core.work_item_comments (legacy_task_comment_id, work_item_id, author_user_id, body, created_at, source_table)
SELECT tc.id, tc.task_id + 1000000000, tc.author_id, tc.body, tc.created_at, 'public.task_comments'
FROM public.task_comments tc
ON CONFLICT (legacy_task_comment_id) DO NOTHING;

INSERT INTO core.work_item_attachments (legacy_task_attachment_id, work_item_id, filename, url, mime_type, size_bytes, uploaded_by, created_at, source_table)
SELECT ta.id, ta.task_id + 1000000000, ta.filename, ta.url, ta.mime_type, ta.size_bytes, ta.uploaded_by, ta.created_at, 'public.task_attachments'
FROM public.task_attachments ta
ON CONFLICT (legacy_task_attachment_id) DO NOTHING;

INSERT INTO core.work_item_activity (legacy_task_activity_id, work_item_id, actor_id, action_type, field_name, old_value, new_value, created_at, source_table)
SELECT tal.id, tal.task_id + 1000000000, tal.actor_id, tal.action_type, tal.field_name, tal.old_value, tal.new_value, tal.created_at, 'public.task_activity_log'
FROM public.task_activity_log tal
ON CONFLICT (legacy_task_activity_id) DO NOTHING;

INSERT INTO core.work_item_watchers (work_item_id, watcher_name, source_table)
SELECT ot.id + 1000000000, watcher_name, 'public.operational_tasks.watchers'
FROM public.operational_tasks ot
CROSS JOIN LATERAL unnest(COALESCE(ot.watchers, ARRAY[]::TEXT[])) AS watcher_name
WHERE ot.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO documentation.documents (
  legacy_deliverable_id, project_id, linked_work_item_id, title, document_type, lifecycle_status, created_by, created_at, updated_at, source_table
)
SELECT d.id,
       COALESCE(d.project_id, cp.id),
       CASE WHEN d.task_id IS NOT NULL THEN d.task_id + 1000000000 ELSE NULL END,
       d.title,
       d.deliverable_type,
       d.status,
       d.created_by,
       d.created_at,
       d.updated_at,
       'public.deliverables'
FROM public.deliverables d
LEFT JOIN core.projects cp ON cp.project_name = d.project_name
ON CONFLICT (legacy_deliverable_id) DO UPDATE
SET title = EXCLUDED.title,
    lifecycle_status = EXCLUDED.lifecycle_status,
    updated_at = EXCLUDED.updated_at;

INSERT INTO documentation.document_versions (
  legacy_deliverable_version_id, document_id, version_number, uploaded_by, created_at, source_table
)
SELECT dv.id, doc.id, dv.version_number, dv.created_by_user_id, dv.created_at, 'public.deliverable_versions'
FROM public.deliverable_versions dv
JOIN documentation.documents doc ON doc.legacy_deliverable_id = dv.deliverable_id
ON CONFLICT (legacy_deliverable_version_id) DO NOTHING;

INSERT INTO documentation.document_versions (
  legacy_deliverable_file_id, document_id, version_number, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at, source_table
)
SELECT df.id,
       doc.id,
       COALESCE(dv.version_number, 1),
       df.web_url,
       df.file_name,
       NULL,
       NULL,
       df.uploaded_by_user_id,
       df.uploaded_at,
       'public.deliverable_files'
FROM public.deliverable_files df
JOIN documentation.documents doc ON doc.legacy_deliverable_id = df.deliverable_id
LEFT JOIN public.deliverable_versions dv ON dv.id = df.version_id
ON CONFLICT DO NOTHING;

INSERT INTO documentation.document_events (
  legacy_deliverable_event_id, document_id, event_type, actor_user_id, payload, created_at, source_table
)
SELECT de.id,
       doc.id,
       de.event_type,
       de.actor_user_id,
       jsonb_build_object('from_status', de.from_status, 'to_status', de.to_status, 'feedback_text', de.feedback_text),
       de.created_at,
       'public.deliverable_events'
FROM public.deliverable_events de
JOIN documentation.documents doc ON doc.legacy_deliverable_id = de.deliverable_id
ON CONFLICT (legacy_deliverable_event_id) DO NOTHING;

INSERT INTO finance.revenue_lines (
  legacy_program_inflow_id, project_id, project_name_snapshot, milestone_name, amount_ex_vat,
  invoice_number, invoice_date, expected_payment_date, paid_date, status, source_table, created_at, updated_at
)
SELECT pi.id,
       cp.id,
       pi.project_name,
       pi.milestone_name,
       NULLIF(pi.milestone_amount, '')::NUMERIC(15,2),
       pi.milestone_invoice_number,
       pi.invoice_raised_date,
       pi.planned_payment_date,
       pi.payment_received_date,
       CASE WHEN COALESCE(pi.in_bank, 0) = 1 THEN 'IN_BANK' ELSE 'PLANNED' END,
       'public.program_inflows',
       pi.created_at,
       pi.created_at
FROM public.program_inflows pi
LEFT JOIN core.projects cp ON cp.project_name = pi.project_name
ON CONFLICT (legacy_program_inflow_id) DO UPDATE
SET status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO finance.revenue_lines (
  legacy_normalized_revenue_line_id, project_id, project_name_snapshot, milestone_name, amount_ex_vat,
  invoice_number, invoice_date, expected_payment_date, paid_date, status, import_run_id, source_table
)
SELECT nrl.id,
       cp.id,
       nrl.project_name,
       nrl.milestone_name,
       NULLIF(nrl.amount_ex_vat, '')::NUMERIC(15,2),
       nrl.invoice_number,
       nrl.invoice_date,
       nrl.expected_payment_date,
       nrl.paid_date,
       nrl.status::TEXT,
       nrl.import_run_id,
       'public.normalized_revenue_lines'
FROM public.normalized_revenue_lines nrl
LEFT JOIN core.projects cp ON cp.project_name = nrl.project_name
ON CONFLICT DO NOTHING;

INSERT INTO finance.cost_lines (
  legacy_program_expense_id, project_id, project_name_snapshot, counterparty_name, description,
  amount_ex_vat, invoice_number, invoice_date, approved_date, paid_date, status, source_table, created_at, updated_at
)
SELECT pe.id,
       cp.id,
       pe.project_name,
       pe.supplier_name,
       pe.expense_line_item,
       NULLIF(pe.expense_actual_total, '')::NUMERIC(15,2),
       pe.expense_invoice_number,
       pe.expense_invoiced_date,
       pe.expense_payment_date,
       pe.expense_payment_date,
       COALESCE(pe.line_status, 'PLANNED'),
       'public.program_expense',
       pe.created_at,
       pe.created_at
FROM public.program_expense pe
LEFT JOIN core.projects cp ON cp.project_name = pe.project_name
ON CONFLICT (legacy_program_expense_id) DO UPDATE
SET status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO finance.cost_lines (
  legacy_normalized_cost_line_id, project_id, project_name_snapshot, counterparty_name, description,
  amount_ex_vat, invoice_number, invoice_date, approved_date, paid_date, status, import_run_id, source_table
)
SELECT ncl.id,
       cp.id,
       ncl.project_name,
       ncl.counterparty_name,
       ncl.description,
       NULLIF(ncl.amount_ex_vat, '')::NUMERIC(15,2),
       ncl.invoice_number,
       ncl.invoice_date,
       ncl.approved_date,
       ncl.paid_date,
       ncl.cost_line_status::TEXT,
       ncl.import_run_id,
       'public.normalized_cost_lines'
FROM public.normalized_cost_lines ncl
LEFT JOIN core.projects cp ON cp.project_name = ncl.project_name
ON CONFLICT DO NOTHING;

INSERT INTO finance.project_revenue_summaries (
  legacy_project_revenue_summary_id, project_id, project_name_snapshot,
  planned_revenue, planned_expenditure, planned_profit,
  actual_revenue, actual_expenditure, actual_profit, captured_at, source_table
)
SELECT prs.id,
       cp.id,
       prs.project_name,
       prs.planned_revenue,
       prs.planned_expenditure,
       prs.planned_profit,
       prs.actual_revenue,
       prs.actual_expenditure,
       prs.actual_profit,
       prs.captured_at,
       'public.project_revenue_summary'
FROM public.project_revenue_summary prs
LEFT JOIN core.projects cp ON cp.project_name = prs.project_name
ON CONFLICT (legacy_project_revenue_summary_id) DO UPDATE
SET captured_at = EXCLUDED.captured_at;

INSERT INTO imports.import_runs (id, legacy_import_run_id, trigger_type, started_at, finished_at, status, triggered_by, summary_json)
SELECT ir.id, ir.id, ir.trigger_type::TEXT, ir.started_at, ir.finished_at, ir.status::TEXT, ir.triggered_by, ir.summary_json
FROM public.import_runs ir
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    finished_at = EXCLUDED.finished_at,
    summary_json = EXCLUDED.summary_json;

INSERT INTO imports.smart_import_runs (
  id, legacy_smart_import_run_id, project_id, project_name_snapshot, uploaded_by, uploaded_at,
  source_file_name, source_file_hash, status, summary_json, committed_at, committed_by
)
SELECT sir.id, sir.id, COALESCE(sir.project_id, cp.id), sir.project_name, sir.uploaded_by, sir.uploaded_at,
       sir.source_file_name, sir.source_file_hash, sir.status::TEXT, sir.summary_json, sir.committed_at, sir.committed_by
FROM public.smart_import_runs sir
LEFT JOIN core.projects cp ON cp.project_name = sir.project_name
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    summary_json = EXCLUDED.summary_json,
    committed_at = EXCLUDED.committed_at,
    committed_by = EXCLUDED.committed_by;

COMMIT;
