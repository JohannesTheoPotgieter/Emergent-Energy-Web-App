-- Migration: Create tables for role-lens (homepage widgets, lens profiles,
-- SSEG applications, contracts, lens simulation sessions, homepage snapshots).
-- All were defined in shared/schema/role-based-upgrade.ts but had no
-- corresponding migration. Additive + idempotent (IF NOT EXISTS throughout).

-- ── role_lens_profiles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_lens_profiles" (
  "id"                  serial PRIMARY KEY,
  "lens_role"           text NOT NULL UNIQUE,
  "label"               text NOT NULL,
  "description"         text,
  "landing_page"        text NOT NULL,
  "allowed_modules"     text[] NOT NULL DEFAULT '{}',
  "nav_priority"        text[] NOT NULL DEFAULT '{}',
  "quick_actions"       jsonb NOT NULL DEFAULT '[]',
  "default_filters"     jsonb NOT NULL DEFAULT '{}',
  "widget_layout"       jsonb NOT NULL DEFAULT '[]',
  "record_tab_emphasis" jsonb NOT NULL DEFAULT '{}',
  "is_system"           boolean NOT NULL DEFAULT true,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now()
);

-- ── role_homepage_widgets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_homepage_widgets" (
  "id"          serial PRIMARY KEY,
  "lens_role"   text NOT NULL,
  "widget_key"  text NOT NULL,
  "label"       text NOT NULL,
  "widget_type" text NOT NULL,
  "data_source" text,
  "position"    integer NOT NULL DEFAULT 0,
  "span"        integer NOT NULL DEFAULT 1,
  "config"      jsonb NOT NULL DEFAULT '{}',
  "is_visible"  boolean NOT NULL DEFAULT true,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now()
);

-- ── contracts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "contracts" (
  "id"                       serial PRIMARY KEY,
  "project_id"               integer REFERENCES "project_info"("id"),
  "opportunity_id"           integer,
  "client_name"              text,
  "counterparty_name"        text,
  "contract_type"            text,
  "contract_reference"       text,
  "signature_status"         text NOT NULL DEFAULT 'draft',
  "signed_date"              date,
  "effective_date"           date,
  "expiry_date"              date,
  "contract_value"           integer,
  "currency"                 text DEFAULT 'ZAR',
  "document_refs"            jsonb NOT NULL DEFAULT '[]',
  "financial_close_relevance" boolean DEFAULT false,
  "notes"                    text,
  "created_by_user_id"       integer REFERENCES "users"("id"),
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "updated_at"               timestamp NOT NULL DEFAULT now(),
  "deleted_at"               timestamp,
  "deleted_by"               integer
);

-- ── sseg_applications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sseg_applications" (
  "id"                  serial PRIMARY KEY,
  "project_id"          integer NOT NULL REFERENCES "project_info"("id"),
  "site_id"             integer,
  "authority"           text NOT NULL,
  "application_stage"   text NOT NULL DEFAULT 'preparation',
  "reference_number"    text,
  "submission_date"     date,
  "query_date"          date,
  "response_due_date"   date,
  "approval_date"       date,
  "expiry_date"         date,
  "required_documents"  jsonb NOT NULL DEFAULT '[]',
  "rejection_notes"     text,
  "query_notes"         text,
  "owner_user_id"       integer REFERENCES "users"("id"),
  "sseg_item_id"        integer,
  "notes"               text,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now(),
  "deleted_at"          timestamp
);

-- ── lens_simulation_sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "lens_simulation_sessions" (
  "id"                    serial PRIMARY KEY,
  "user_id"               integer NOT NULL REFERENCES "users"("id"),
  "simulated_lens_role"   text NOT NULL,
  "simulated_user_id"     integer REFERENCES "users"("id"),
  "mode"                  text NOT NULL DEFAULT 'read_only',
  "is_active"             boolean NOT NULL DEFAULT true,
  "started_at"            timestamp NOT NULL DEFAULT now(),
  "ended_at"              timestamp
);

-- ── role_homepage_snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_homepage_snapshots" (
  "id"            serial PRIMARY KEY,
  "lens_role"     text NOT NULL,
  "user_id"       integer REFERENCES "users"("id"),
  "snapshot_data" jsonb NOT NULL DEFAULT '{}',
  "computed_at"   timestamp NOT NULL DEFAULT now()
);
