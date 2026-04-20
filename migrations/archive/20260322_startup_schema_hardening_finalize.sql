-- Final startup hardening extraction.
-- Move remaining runtime/route-level schema evolution into explicit migration.
-- Additive and non-destructive only.

-- Runtime compatibility blocks extracted from server/bootstrap/runtime-schema-compatibility.ts
ALTER TABLE IF EXISTS project_info ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_project_info_client_id ON project_info(client_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_type') THEN
    CREATE TYPE pm_action_type AS ENUM ('site_visit','generate_po','link_invoice','raise_variation','log_delay','log_risk','upload_photo','update_progress','escalate');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_status') THEN
    CREATE TYPE pm_action_status AS ENUM ('pending','approved','rejected','completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_safety_status') THEN
    CREATE TYPE pm_safety_status AS ENUM ('clear','issue_open');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_workstream') THEN
    CREATE TYPE work_item_workstream AS ENUM ('PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_source') THEN
    CREATE TYPE work_item_source AS ENUM ('SMART_IMPORT', 'UI', 'INTEGRATION', 'SYSTEM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_assignment_role') THEN
    CREATE TYPE work_item_assignment_role AS ENUM ('OWNER', 'ASSIGNEE', 'REVIEWER', 'VIEWER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_dep_type') THEN
    CREATE TYPE work_item_dep_type AS ENUM ('FS', 'SS', 'FF', 'SF');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_type') THEN
    CREATE TYPE raid_type AS ENUM ('risk','assumption','issue','decision');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_status') THEN
    CREATE TYPE raid_status AS ENUM ('open','mitigating','resolved','closed','accepted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_priority') THEN
    CREATE TYPE raid_priority AS ENUM ('low','medium','high','critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_type') THEN
    CREATE TYPE change_request_type AS ENUM ('scope','cost','schedule','technical','commercial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_status') THEN
    CREATE TYPE change_request_status AS ENUM ('draft','submitted','under_review','approved','rejected','implemented','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_category') THEN
    CREATE TYPE procurement_category AS ENUM ('material','equipment','service','subcontract','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_status') THEN
    CREATE TYPE procurement_status AS ENUM ('requested','quoted','approved','ordered','partially_received','received','invoiced','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commissioning_status') THEN
    CREATE TYPE commissioning_status AS ENUM ('not_started','in_progress','ready_for_review','approved','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_capture_status') THEN
    CREATE TYPE invoice_capture_status AS ENUM ('captured','submitted','verified','approved','rejected');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS pm_site_visits (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  visit_date DATE NOT NULL,
  notes TEXT,
  weather_conditions TEXT,
  safety_status pm_safety_status DEFAULT 'clear',
  photo_ids JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT,
  source TEXT DEFAULT 'on_the_go'
);

CREATE TABLE IF NOT EXISTS pm_on_the_go_actions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  action_type pm_action_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT,
  amount DECIMAL(15,2),
  status pm_action_status DEFAULT 'pending',
  related_entity_id INTEGER,
  related_entity_type TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT,
  source TEXT DEFAULT 'on_the_go'
);

CREATE TABLE IF NOT EXISTS pm_compliance_tracking (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  week_start_date DATE NOT NULL,
  daily_diary_done JSONB DEFAULT '[]',
  weekly_progress_done BOOLEAN DEFAULT FALSE,
  weekly_risk_done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id, week_start_date)
);

CREATE TABLE IF NOT EXISTS pm_mode_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  preferred_mode TEXT DEFAULT 'full_detail',
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolios (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_rollout_plans (
  id SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_rollout_phases (
  id SERIAL PRIMARY KEY,
  rollout_plan_id INTEGER NOT NULL REFERENCES portfolio_rollout_plans(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  target_kwp DECIMAL(12,2),
  target_revenue DECIMAL(15,2),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_portfolio_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) UNIQUE,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  moved_by INTEGER REFERENCES users(id),
  moved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_items (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  project_id INTEGER REFERENCES project_info(id),
  workstream work_item_workstream NOT NULL,
  type TEXT,
  source work_item_source NOT NULL DEFAULT 'UI',
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
  owner_user_id INTEGER REFERENCES users(id),
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  external_ref TEXT UNIQUE,
  legacy_table TEXT,
  legacy_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS expected_pct_complete REAL;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS indent_level INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS source_row INTEGER;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS baseline_start TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS baseline_end TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS baseline_duration INTEGER;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS task_mode TEXT DEFAULT 'auto';
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS actual_start TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS actual_end TEXT;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS actual_duration INTEGER;
ALTER TABLE IF EXISTS work_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS work_item_assignments (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role work_item_assignment_role NOT NULL DEFAULT 'ASSIGNEE',
  allocation_pct REAL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_item_dependencies (
  id SERIAL PRIMARY KEY,
  predecessor_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  successor_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  dep_type work_item_dep_type NOT NULL DEFAULT 'FS',
  lag_days INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_item_comments (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_item_attachments (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_item_status_history (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reason TEXT
);

CREATE TABLE IF NOT EXISTS project_client_history (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  old_client_id INTEGER REFERENCES clients(id),
  new_client_id INTEGER REFERENCES clients(id),
  moved_by_user_id INTEGER NOT NULL REFERENCES users(id),
  moved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reason TEXT
);

CREATE TABLE IF NOT EXISTS import_field_mappings (
  id SERIAL PRIMARY KEY,
  import_profile TEXT NOT NULL,
  sheet_name TEXT,
  excel_column_header TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_field TEXT NOT NULL,
  transform TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_backups (
  id SERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL,
  backup_type TEXT NOT NULL DEFAULT 'manual',
  description TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_cleanup_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  archived_name TEXT,
  row_count INTEGER,
  performed_by_user_id INTEGER REFERENCES users(id),
  performed_by_name TEXT,
  backup_id TEXT,
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS user_project_folders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_name TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  folder_path TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, project_name)
);

ALTER TABLE IF EXISTS ms_accounts ADD COLUMN IF NOT EXISTS sso_access_token TEXT;
ALTER TABLE IF EXISTS ms_accounts ADD COLUMN IF NOT EXISTS sso_token_expires_at TIMESTAMP;

-- Route-level ensure* DDL extraction
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_ref TEXT NOT NULL UNIQUE,
  po_number INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  supplier_name TEXT NOT NULL,
  supplier_vat TEXT,
  supplier_address TEXT,
  supplier_contact TEXT,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_terms TEXT,
  delivery_date TEXT,
  delivery_address TEXT,
  site_contact TEXT,
  comments TEXT,
  project_manager TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP,
  pdf_data BYTEA
);
CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_name);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE SEQUENCE IF NOT EXISTS po_number_seq START WITH 3800;

ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS linked_work_item_id INTEGER REFERENCES work_items(id);
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS linked_cost_line_id INTEGER REFERENCES normalized_cost_lines(id);
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS linked_revenue_line_id INTEGER REFERENCES normalized_revenue_lines(id);
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE IF EXISTS deliverables ADD COLUMN IF NOT EXISTS original_file_name TEXT;

CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  badge_key TEXT NOT NULL,
  awarded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  meta JSONB,
  UNIQUE(user_id, badge_key)
);
CREATE TABLE IF NOT EXISTS user_points (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  description TEXT,
  awarded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_unique ON user_badges(user_id, badge_key);

CREATE TABLE IF NOT EXISTS project_handover_gates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  checked_items JSONB DEFAULT '[]',
  completed_at TIMESTAMP,
  completed_by_user_id INTEGER REFERENCES users(id),
  completed_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, gate_id)
);
CREATE TABLE IF NOT EXISTS project_handover_history (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  performed_by_user_id INTEGER REFERENCES users(id),
  performed_by_name TEXT,
  performed_by_role TEXT,
  details JSONB,
  performed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_pd_pm_handover (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES project_info(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  handover_status_text TEXT,
  pd_owner TEXT,
  pm_owner TEXT,
  summary TEXT,
  risks TEXT,
  assumptions TEXT,
  engineering_status TEXT,
  quality_status TEXT,
  notes_to_pm TEXT,
  handover_summary TEXT,
  deliverables JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_by TEXT,
  submitted_at TIMESTAMP,
  accepted_by TEXT,
  accepted_at TIMESTAMP,
  rejected_by TEXT,
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raid_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  type raid_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  status raid_status NOT NULL DEFAULT 'open',
  priority raid_priority NOT NULL DEFAULT 'medium',
  due_date TEXT,
  mitigation_response TEXT,
  linked_task_id INTEGER,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  title TEXT NOT NULL,
  description TEXT,
  change_type change_request_type NOT NULL,
  requested_by_user_id INTEGER REFERENCES users(id),
  owner_user_id INTEGER REFERENCES users(id),
  impact_summary TEXT,
  cost_impact REAL,
  schedule_impact_days INTEGER,
  status change_request_status NOT NULL DEFAULT 'draft',
  approval_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  title TEXT NOT NULL,
  description TEXT,
  category procurement_category NOT NULL DEFAULT 'other',
  quantity REAL,
  unit TEXT,
  expected_cost REAL,
  actual_cost REAL,
  supplier_id INTEGER REFERENCES counterparties(id),
  requested_by_user_id INTEGER REFERENCES users(id),
  owner_user_id INTEGER REFERENCES users(id),
  status procurement_status NOT NULL DEFAULT 'requested',
  required_date TEXT,
  po_id INTEGER,
  invoice_ref TEXT,
  linked_task_id INTEGER,
  approval_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commissioning_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  item_type TEXT NOT NULL DEFAULT 'commissioning',
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  due_date TEXT,
  status commissioning_status NOT NULL DEFAULT 'not_started',
  evidence_notes TEXT,
  approval_id INTEGER,
  gate_id TEXT,
  category TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_captures (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  supplier_id INTEGER REFERENCES counterparties(id),
  invoice_number TEXT,
  invoice_date TEXT,
  amount REAL,
  vat_amount REAL,
  linked_po_id INTEGER,
  linked_procurement_item_id INTEGER,
  status invoice_capture_status NOT NULL DEFAULT 'captured',
  captured_by_user_id INTEGER REFERENCES users(id),
  document_path TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subcontractor_assignment_status') THEN
    CREATE TYPE subcontractor_assignment_status AS ENUM ('active','completed','suspended','terminated');
  END IF;
END
$$;

ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS registration_number TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS bank_branch_code TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE IF EXISTS counterparties ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS project_subcontractor_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  counterparty_id INTEGER NOT NULL REFERENCES counterparties(id),
  work_package TEXT,
  scope_description TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  status subcontractor_assignment_status NOT NULL DEFAULT 'active',
  key_dates JSONB,
  performance_notes TEXT,
  linked_approval_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
