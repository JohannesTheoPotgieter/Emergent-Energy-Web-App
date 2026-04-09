-- =====================================================
-- Sync dev database to match production exactly
-- Creates missing tables, views, and FK constraints
-- =====================================================

-- 1. Create legacy tables
-- _work_items_legacy
CREATE TABLE IF NOT EXISTS _work_items_legacy (
  id SERIAL PRIMARY KEY,
  client_id INTEGER,
  project_id INTEGER,
  workstream TEXT NOT NULL DEFAULT 'PM',
  type TEXT,
  source TEXT NOT NULL DEFAULT 'UI',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Not Started',
  priority TEXT,
  start_date TEXT,
  end_date TEXT,
  duration INTEGER,
  percent_complete REAL DEFAULT 0,
  wbs_code TEXT,
  outline_number TEXT,
  parent_id INTEGER,
  owner_user_id INTEGER,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  external_ref TEXT,
  legacy_table TEXT,
  legacy_id INTEGER,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  scheduled_date TEXT,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  expected_pct_complete REAL,
  indent_level INTEGER DEFAULT 0,
  is_milestone BOOLEAN DEFAULT false,
  phase TEXT,
  owner_name TEXT,
  source_row INTEGER,
  source_sheet TEXT,
  import_run_id INTEGER,
  baseline_start TEXT,
  baseline_end TEXT,
  baseline_duration INTEGER,
  task_mode TEXT DEFAULT 'auto',
  actual_start TEXT,
  actual_end TEXT,
  actual_duration INTEGER,
  sort_order INTEGER DEFAULT 0,
  estimate_minutes INTEGER,
  task_category TEXT,
  is_recurring BOOLEAN DEFAULT false,
  recurrence_frequency TEXT,
  recurrence_interval INTEGER DEFAULT 1,
  recurrence_days_of_week TEXT,
  recurrence_end_date TEXT,
  recurrence_parent_id INTEGER,
  sub_project_name TEXT,
  hold_reason TEXT,
  blocked_type TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  linked_plan_item_id INTEGER,
  linked_deliverable_id INTEGER,
  linked_quality_item_instance_id INTEGER,
  completed_at TIMESTAMP,
  tracking_rag TEXT,
  task_type_tag TEXT,
  blocker_reason TEXT,
  pd_ticket_id INTEGER,
  planned_hours REAL,
  actual_hours REAL DEFAULT 0,
  bucket TEXT,
  pinned_today BOOLEAN DEFAULT false,
  pinned_week BOOLEAN DEFAULT false,
  source_email_id TEXT,
  source_email_subject TEXT,
  next_step TEXT,
  definition_of_done TEXT,
  completion_note TEXT
);

-- _deliverables_legacy
CREATE TABLE IF NOT EXISTS _deliverables_legacy (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  deliverable_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT,
  owner_user_id INTEGER,
  reviewer_user_id INTEGER,
  qc_reviewer_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'TO DO',
  current_version INTEGER NOT NULL DEFAULT 1,
  sharepoint_folder_site_id TEXT,
  sharepoint_folder_drive_id TEXT,
  sharepoint_folder_item_id TEXT,
  linked_plan_item_id INTEGER,
  linked_quality_item_instance_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  project_id INTEGER,
  scheduled_date TEXT,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  linked_work_item_id INTEGER,
  linked_cost_line_id INTEGER,
  linked_revenue_line_id INTEGER,
  file_path TEXT,
  file_size INTEGER,
  mime_type TEXT,
  original_file_name TEXT
);

-- _approvals_legacy
CREATE TABLE IF NOT EXISTS _approvals_legacy (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_by INTEGER,
  decided_at TIMESTAMP,
  decision_note TEXT,
  token TEXT,
  expires_at TIMESTAMP,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  assigned_approver INTEGER,
  due_date TIMESTAMP,
  project_id INTEGER,
  approval_category TEXT,
  approval_type TEXT,
  urgency TEXT DEFAULT 'normal',
  evidence_links TEXT,
  deleted_at TIMESTAMP,
  deleted_by INTEGER,
  delete_reason TEXT,
  scheduled_date DATE,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT
);

-- commissioning_snapshots
CREATE TABLE IF NOT EXISTS commissioning_snapshots (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_id INTEGER,
  source_etag TEXT,
  source_ctag TEXT,
  source_modified_at TIMESTAMP,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_message TEXT,
  parsed_sections JSONB NOT NULL DEFAULT '[]',
  parsed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_latest BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- commissioning_sources
CREATE TABLE IF NOT EXISTS commissioning_sources (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'sharepoint',
  source_format TEXT NOT NULL DEFAULT 'commissioning_workbook',
  drive_id TEXT,
  item_id TEXT,
  file_path TEXT,
  workbook_url TEXT,
  folder_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER
);

-- contracts
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER,
  opportunity_id INTEGER,
  client_name TEXT,
  counterparty_name TEXT,
  contract_type TEXT,
  contract_reference TEXT,
  signature_status TEXT NOT NULL DEFAULT 'draft',
  signed_date DATE,
  effective_date DATE,
  expiry_date DATE,
  contract_value INTEGER,
  currency TEXT DEFAULT 'ZAR',
  document_refs JSONB NOT NULL DEFAULT '[]',
  financial_close_relevance BOOLEAN DEFAULT false,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER
);

-- fiscal_years
CREATE TABLE IF NOT EXISTS fiscal_years (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- fiscal_periods
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id SERIAL PRIMARY KEY,
  fiscal_year_id INTEGER NOT NULL REFERENCES fiscal_years(id),
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- lens_simulation_sessions
CREATE TABLE IF NOT EXISTS lens_simulation_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  simulated_lens_role TEXT NOT NULL,
  simulated_user_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'read_only',
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP
);

-- role_homepage_snapshots
CREATE TABLE IF NOT EXISTS role_homepage_snapshots (
  id SERIAL PRIMARY KEY,
  lens_role TEXT NOT NULL,
  user_id INTEGER,
  snapshot_data JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- role_homepage_widgets
CREATE TABLE IF NOT EXISTS role_homepage_widgets (
  id SERIAL PRIMARY KEY,
  lens_role TEXT NOT NULL,
  widget_key TEXT NOT NULL,
  label TEXT NOT NULL,
  widget_type TEXT NOT NULL,
  data_source TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  span INTEGER NOT NULL DEFAULT 1,
  config JSONB NOT NULL DEFAULT '{}',
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- role_lens_profiles
CREATE TABLE IF NOT EXISTS role_lens_profiles (
  id SERIAL PRIMARY KEY,
  lens_role TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  landing_page TEXT NOT NULL,
  allowed_modules TEXT[] NOT NULL DEFAULT '{}',
  nav_priority TEXT[] NOT NULL DEFAULT '{}',
  quick_actions JSONB NOT NULL DEFAULT '[]',
  default_filters JSONB NOT NULL DEFAULT '{}',
  widget_layout JSONB NOT NULL DEFAULT '[]',
  record_tab_emphasis JSONB NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- sseg_applications
CREATE TABLE IF NOT EXISTS sseg_applications (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  site_id INTEGER,
  authority TEXT NOT NULL,
  application_stage TEXT NOT NULL DEFAULT 'preparation',
  reference_number TEXT,
  submission_date DATE,
  query_date DATE,
  response_due_date DATE,
  approval_date DATE,
  expiry_date DATE,
  required_documents JSONB NOT NULL DEFAULT '[]',
  rejection_notes TEXT,
  query_notes TEXT,
  owner_user_id INTEGER,
  sseg_item_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- task_time_entries (no FK to work_items — will add FK to _work_items_legacy)
CREATE TABLE IF NOT EXISTS task_time_entries (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER
);

-- work_item_tags (no FK to work_items — will add FK to _work_items_legacy)
CREATE TABLE IF NOT EXISTS work_item_tags (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE work_item_tags ADD CONSTRAINT work_item_tags_unique UNIQUE (work_item_id, tag_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- 2. Create VIEWS matching production
-- work_items view → points to _work_items_legacy (in prod it points to core.work_items)
CREATE OR REPLACE VIEW work_items AS
  SELECT id, client_id, project_id, workstream, type, source, title, description,
    status, priority, start_date, end_date, duration, percent_complete, wbs_code,
    outline_number, parent_id, owner_user_id, is_shared, external_ref, legacy_table,
    legacy_id, created_by, created_at, updated_at, deleted_at, scheduled_date,
    scheduled_start_time, scheduled_end_time, expected_pct_complete, indent_level,
    is_milestone, phase, owner_name, source_row, source_sheet, import_run_id,
    baseline_start, baseline_end, baseline_duration, task_mode, actual_start,
    actual_end, actual_duration, sort_order, estimate_minutes, task_category,
    is_recurring, recurrence_frequency, recurrence_interval, recurrence_days_of_week,
    recurrence_end_date, recurrence_parent_id, sub_project_name, hold_reason,
    blocked_type, approval_required, linked_plan_item_id, linked_deliverable_id,
    linked_quality_item_instance_id, completed_at, tracking_rag, task_type_tag,
    blocker_reason, pd_ticket_id, planned_hours, actual_hours, bucket, pinned_today,
    pinned_week, source_email_id, source_email_subject, next_step, definition_of_done,
    completion_note
  FROM _work_items_legacy;

-- deliverables view → points to _deliverables_legacy
CREATE OR REPLACE VIEW deliverables AS
  SELECT id, project_id, project_name, title, deliverable_type, description, phase,
    owner_user_id, reviewer_user_id, qc_reviewer_user_id, status, current_version,
    sharepoint_folder_site_id, sharepoint_folder_drive_id, sharepoint_folder_item_id,
    linked_plan_item_id, linked_quality_item_instance_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, linked_cost_line_id, linked_revenue_line_id,
    file_path, file_size, mime_type, original_file_name, created_at, updated_at
  FROM _deliverables_legacy;

-- approvals_legacy_view_20260407 → points to _approvals_legacy
CREATE OR REPLACE VIEW approvals_legacy_view_20260407 AS
  SELECT id, type, title, description, status, decision_note, decided_at,
    requested_by, requested_at, decided_by, token, expires_at, assigned_approver,
    due_date, project_id, approval_category, approval_type,
    related_entity_type, related_entity_id,
    requested_by AS requested_by_user_id, urgency, evidence_links,
    deleted_at, deleted_by, delete_reason,
    scheduled_date, scheduled_start_time, scheduled_end_time,
    requested_at AS created_at
  FROM _approvals_legacy;

-- priority_derived_metrics (complex view — create a stub that returns empty)
DO $$ BEGIN
  CREATE OR REPLACE VIEW priority_derived_metrics AS
    SELECT cp.id AS priority_id,
      count(DISTINCT pp.project_id) AS project_count,
      count(DISTINCT CASE WHEN lower(pes.rag_status) = 'red' THEN pp.project_id ELSE NULL END) AS at_risk_project_count,
      CASE
        WHEN bool_or(lower(pes.rag_status) = 'red') THEN 'critical'
        WHEN bool_or(lower(pes.rag_status) = ANY(ARRAY['amber','orange'])) THEN 'at_risk'
        WHEN count(DISTINCT pp.project_id) = 0 THEN NULL
        ELSE 'healthy'
      END AS derived_health,
      COALESCE(sum(dpk.total_planned_revenue::numeric), 0) AS total_revenue,
      COALESCE(sum(dpk.total_planned_expenses::numeric), 0) AS total_cos,
      (COALESCE(sum(dpk.total_planned_revenue::numeric), 0) - COALESCE(sum(dpk.total_planned_expenses::numeric), 0)) AS total_gp,
      COALESCE(avg(dpk.avg_actual_pct_complete::numeric), 0) AS avg_progress,
      (SELECT count(*) FROM work_items wi WHERE wi.project_id IN (SELECT priority_projects.project_id FROM priority_projects WHERE priority_projects.priority_id = cp.id) AND lower(wi.status) LIKE '%block%' AND wi.deleted_at IS NULL) AS blocker_count,
      (SELECT count(*) FROM work_items wi WHERE wi.project_id IN (SELECT priority_projects.project_id FROM priority_projects WHERE priority_projects.priority_id = cp.id) AND lower(wi.status) NOT IN ('complete','completed','done','cancelled','canceled','qc approved') AND wi.deleted_at IS NULL) AS open_task_count
    FROM mytool_company_priorities cp
    LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
    LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
    LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
    GROUP BY cp.id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'priority_derived_metrics view creation skipped: %', SQLERRM;
END $$;


-- 3. Add FK constraints to match production

-- _work_items_legacy FKs
DO $$ BEGIN ALTER TABLE _work_items_legacy ADD CONSTRAINT work_items_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _work_items_legacy ADD CONSTRAINT work_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _work_items_legacy ADD CONSTRAINT work_items_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _work_items_legacy ADD CONSTRAINT work_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _work_items_legacy ADD CONSTRAINT work_items_pd_ticket_id_fkey FOREIGN KEY (pd_ticket_id) REFERENCES pd_tickets(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- _deliverables_legacy FKs
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_reviewer_user_id_fkey FOREIGN KEY (reviewer_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_qc_reviewer_user_id_fkey FOREIGN KEY (qc_reviewer_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_linked_work_item_id_fkey FOREIGN KEY (linked_work_item_id) REFERENCES _work_items_legacy(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_linked_cost_line_id_fkey FOREIGN KEY (linked_cost_line_id) REFERENCES normalized_cost_lines(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _deliverables_legacy ADD CONSTRAINT deliverables_linked_revenue_line_id_fkey FOREIGN KEY (linked_revenue_line_id) REFERENCES normalized_revenue_lines(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- _approvals_legacy FKs
DO $$ BEGIN ALTER TABLE _approvals_legacy ADD CONSTRAINT approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _approvals_legacy ADD CONSTRAINT approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _approvals_legacy ADD CONSTRAINT approvals_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE _approvals_legacy ADD CONSTRAINT approvals_assigned_approver_fkey FOREIGN KEY (assigned_approver) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- approvals table — prod has _fk_20260407 suffix versions instead of the dev versions
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_assigned_approver_fkey;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_decided_by_fkey;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_project_id_fkey;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_requested_by_fkey;
DO $$ BEGIN ALTER TABLE approvals ADD CONSTRAINT approvals_assigned_approver_fk_20260407 FOREIGN KEY (assigned_approver) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE approvals ADD CONSTRAINT approvals_decided_by_fk_20260407 FOREIGN KEY (decided_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE approvals ADD CONSTRAINT approvals_project_id_fk_20260407 FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE approvals ADD CONSTRAINT approvals_requested_by_fk_20260407 FOREIGN KEY (requested_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- deliverable_events FK to _deliverables_legacy
ALTER TABLE deliverable_events DROP CONSTRAINT IF EXISTS deliverable_events_deliverable_id_fkey;
DO $$ BEGIN ALTER TABLE deliverable_events ADD CONSTRAINT deliverable_events_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES _deliverables_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- deliverable_files FK to _deliverables_legacy
ALTER TABLE deliverable_files DROP CONSTRAINT IF EXISTS deliverable_files_deliverable_id_fkey;
DO $$ BEGIN ALTER TABLE deliverable_files ADD CONSTRAINT deliverable_files_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES _deliverables_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- deliverable_versions FK to _deliverables_legacy
ALTER TABLE deliverable_versions DROP CONSTRAINT IF EXISTS deliverable_versions_deliverable_id_fkey;
DO $$ BEGIN ALTER TABLE deliverable_versions ADD CONSTRAINT deliverable_versions_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES _deliverables_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- commissioning FKs
DO $$ BEGIN ALTER TABLE commissioning_snapshots ADD CONSTRAINT commissioning_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE commissioning_snapshots ADD CONSTRAINT commissioning_snapshots_source_id_fkey FOREIGN KEY (source_id) REFERENCES commissioning_sources(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE commissioning_sources ADD CONSTRAINT commissioning_sources_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE commissioning_sources ADD CONSTRAINT commissioning_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- contracts FKs
DO $$ BEGIN ALTER TABLE contracts ADD CONSTRAINT contracts_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contracts ADD CONSTRAINT contracts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- fiscal_periods FK
DO $$ BEGIN ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- lens_simulation_sessions FKs
DO $$ BEGIN ALTER TABLE lens_simulation_sessions ADD CONSTRAINT lens_simulation_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lens_simulation_sessions ADD CONSTRAINT lens_simulation_sessions_simulated_user_id_fkey FOREIGN KEY (simulated_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- role_homepage_snapshots FK
DO $$ BEGIN ALTER TABLE role_homepage_snapshots ADD CONSTRAINT role_homepage_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sseg_applications FKs
DO $$ BEGIN ALTER TABLE sseg_applications ADD CONSTRAINT sseg_applications_project_id_fkey FOREIGN KEY (project_id) REFERENCES project_info(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE sseg_applications ADD CONSTRAINT sseg_applications_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- project_eng_tasks FK to _work_items_legacy
ALTER TABLE project_eng_tasks DROP CONSTRAINT IF EXISTS project_eng_tasks_work_item_id_fkey;
DO $$ BEGIN ALTER TABLE project_eng_tasks ADD CONSTRAINT project_eng_tasks_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- task_time_entries FKs to _work_items_legacy
DO $$ BEGIN ALTER TABLE task_time_entries ADD CONSTRAINT task_time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE task_time_entries ADD CONSTRAINT task_time_entries_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- work_item_tags FKs to _work_items_legacy
DO $$ BEGIN ALTER TABLE work_item_tags ADD CONSTRAINT work_item_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES task_tags(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_tags ADD CONSTRAINT work_item_tags_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- work_item_* supporting tables FKs to _work_items_legacy
DO $$ BEGIN ALTER TABLE work_item_assignments ADD CONSTRAINT work_item_assignments_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_attachments ADD CONSTRAINT work_item_attachments_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_comments ADD CONSTRAINT work_item_comments_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_dependencies ADD CONSTRAINT work_item_dependencies_predecessor_id_fkey FOREIGN KEY (predecessor_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_dependencies ADD CONSTRAINT work_item_dependencies_successor_id_fkey FOREIGN KEY (successor_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_item_status_history ADD CONSTRAINT work_item_status_history_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES _work_items_legacy(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
