-- Smart Import System Migration
-- Creates enums and tables for the Smart Import pipeline

-- ===================== ENUMS =====================

DO $$ BEGIN
  CREATE TYPE smart_import_status AS ENUM ('PREVIEW', 'AWAITING_REVIEW', 'COMMITTED', 'ROLLED_BACK', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE import_issue_severity AS ENUM ('INFO', 'WARNING', 'BLOCKER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE import_section AS ENUM ('PLAN', 'REVENUE', 'EXPENDITURE', 'CASHFLOW', 'GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE counterparty_type AS ENUM ('SUPPLIER', 'INSTALLER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE revenue_line_status AS ENUM ('PLANNED', 'INVOICED', 'PAID', 'IN_BANK', 'REALISED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE cost_line_status AS ENUM ('PLANNED', 'INVOICED', 'APPROVED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE phase_source AS ENUM ('EXCEL_IMPORT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===================== TABLES =====================

CREATE TABLE IF NOT EXISTS smart_import_runs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_file_name TEXT NOT NULL,
  source_file_hash TEXT,
  status smart_import_status NOT NULL DEFAULT 'PREVIEW',
  template_profile_id INTEGER,
  summary_json JSONB,
  committed_at TIMESTAMP,
  committed_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS import_issues (
  id SERIAL PRIMARY KEY,
  import_run_id INTEGER NOT NULL REFERENCES smart_import_runs(id),
  severity import_issue_severity NOT NULL,
  section import_section NOT NULL,
  message TEXT NOT NULL,
  suggested_action TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TIMESTAMP,
  payload_json JSONB
);

CREATE TABLE IF NOT EXISTS template_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  signature_json JSONB,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mapping_rules (
  id SERIAL PRIMARY KEY,
  template_profile_id INTEGER NOT NULL REFERENCES template_profiles(id),
  section import_section NOT NULL,
  source_header TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  confidence_weight REAL NOT NULL DEFAULT 1.0,
  examples_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS normalized_plan_tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  task_name TEXT NOT NULL,
  phase TEXT,
  start_date TEXT,
  end_date TEXT,
  duration_days INTEGER,
  owner TEXT,
  status TEXT,
  pct_complete REAL,
  source_sheet TEXT,
  source_row INTEGER,
  import_run_id INTEGER NOT NULL REFERENCES smart_import_runs(id)
);

CREATE TABLE IF NOT EXISTS normalized_revenue_lines (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  description TEXT,
  milestone_name TEXT,
  amount_ex_vat TEXT,
  vat TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  expected_payment_date TEXT,
  paid_date TEXT,
  in_bank_date TEXT,
  status revenue_line_status NOT NULL DEFAULT 'PLANNED',
  source_sheet TEXT,
  source_row INTEGER,
  import_run_id INTEGER NOT NULL REFERENCES smart_import_runs(id),
  turnaround_days INTEGER
);

CREATE TABLE IF NOT EXISTS counterparties (
  id SERIAL PRIMARY KEY,
  name_canonical TEXT NOT NULL,
  name_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  type_default counterparty_type NOT NULL DEFAULT 'OTHER',
  is_core BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS normalized_cost_lines (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  cost_category TEXT,
  counterparty_id INTEGER REFERENCES counterparties(id),
  counterparty_name TEXT,
  counterparty_type counterparty_type,
  description TEXT,
  amount_ex_vat TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  approved_date TEXT,
  paid_date TEXT,
  po_number TEXT,
  cost_line_status cost_line_status NOT NULL DEFAULT 'PLANNED',
  source_sheet TEXT,
  source_row INTEGER,
  import_run_id INTEGER NOT NULL REFERENCES smart_import_runs(id),
  turnaround_days INTEGER
);

CREATE TABLE IF NOT EXISTS normalized_execution_phases (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  phase_date TEXT,
  source phase_source NOT NULL DEFAULT 'EXCEL_IMPORT',
  import_run_id INTEGER REFERENCES smart_import_runs(id)
);
