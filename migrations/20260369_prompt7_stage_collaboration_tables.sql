-- Prompt 7: Stage Collaboration Tables + SSEG extensions
-- Creates: project_client_commitments, project_client_updates, project_queries,
--          project_access, project_stage_financial_close_tracks
-- Extends: sseg_items (techsitter_confirmed, metering_confirmed)

BEGIN;

-- ============================================================
-- 1. EXTEND EXISTING TABLES
-- ============================================================

ALTER TABLE sseg_items ADD COLUMN IF NOT EXISTS techsitter_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE sseg_items ADD COLUMN IF NOT EXISTS metering_confirmed BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

-- Client promise tracking
CREATE TABLE IF NOT EXISTS project_client_commitments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code_created TEXT,
  commitment_text TEXT NOT NULL,
  committed_by_user_id INTEGER REFERENCES users(id),
  committed_date TIMESTAMP NOT NULL DEFAULT NOW(),
  delivery_stage_code TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  delivered_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pcc_project_id_idx ON project_client_commitments(project_id);
CREATE INDEX IF NOT EXISTS pcc_status_idx ON project_client_commitments(status);

-- Weekly client communication
CREATE TABLE IF NOT EXISTS project_client_updates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  update_number INTEGER NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  progress_summary_text TEXT,
  completed_this_period_text TEXT,
  next_7_days_text TEXT,
  blockers_text TEXT,
  client_actions_required_text TEXT,
  attachment_urls JSONB DEFAULT '[]',
  sent_by_user_id INTEGER REFERENCES users(id),
  reviewer_user_id INTEGER REFERENCES users(id),
  sent_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT pcu_project_update_uq UNIQUE (project_id, update_number)
);
CREATE INDEX IF NOT EXISTS pcu_project_id_idx ON project_client_updates(project_id);
CREATE INDEX IF NOT EXISTS pcu_status_idx ON project_client_updates(status);

-- Structured query routing
CREATE TABLE IF NOT EXISTS project_queries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT,
  query_type TEXT NOT NULL,
  raised_by_user_id INTEGER REFERENCES users(id),
  raised_by_department TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id),
  assigned_to_department TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'OPEN',
  response_text TEXT,
  responded_by_user_id INTEGER REFERENCES users(id),
  responded_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pq_project_id_idx ON project_queries(project_id);
CREATE INDEX IF NOT EXISTS pq_status_idx ON project_queries(status);
CREATE INDEX IF NOT EXISTS pq_assigned_to_idx ON project_queries(assigned_to_user_id);

-- Project-level access control
CREATE TABLE IF NOT EXISTS project_access (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  access_level TEXT NOT NULL DEFAULT 'VIEWER',
  role_on_project TEXT,
  stages_visible JSONB DEFAULT '["all"]',
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by_user_id INTEGER REFERENCES users(id),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  notes TEXT,
  CONSTRAINT pa_project_user_uq UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS pa_project_id_idx ON project_access(project_id);
CREATE INDEX IF NOT EXISTS pa_user_id_idx ON project_access(user_id);

-- Financial close deliverable tracks
CREATE TABLE IF NOT EXISTS project_stage_financial_close_tracks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_instance_id INTEGER REFERENCES project_stage_instances(id) ON DELETE CASCADE,
  track_code TEXT NOT NULL,
  track_label TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  signed BOOLEAN NOT NULL DEFAULT FALSE,
  signed_date DATE,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT psfct_project_track_uq UNIQUE (project_id, track_code)
);
CREATE INDEX IF NOT EXISTS psfct_project_id_idx ON project_stage_financial_close_tracks(project_id);
CREATE INDEX IF NOT EXISTS psfct_stage_instance_idx ON project_stage_financial_close_tracks(stage_instance_id);

COMMIT;
