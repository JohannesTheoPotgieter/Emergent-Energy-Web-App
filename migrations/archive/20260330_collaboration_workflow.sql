-- ============================================================
-- MIGRATION: Collaboration Workflow Engine (Prompt 5)
-- Adds: acceptance workflow, client commitments, evidence
--   requests, project queries, client updates
-- Enhances: project_stage_requirements with contributors
-- ============================================================

-- 1. Add contributors column to existing requirements table
ALTER TABLE project_stage_requirements
  ADD COLUMN IF NOT EXISTS contributors jsonb DEFAULT '[]';

-- 2. Stage Acceptances — formal acceptance for handover stages
CREATE TABLE IF NOT EXISTS stage_acceptances (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  outcome TEXT NOT NULL,  -- accepted / accepted_with_reservations / rejected
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_date TIMESTAMP NOT NULL DEFAULT NOW(),
  rejection_reason TEXT,
  admin_override BOOLEAN NOT NULL DEFAULT FALSE,
  admin_override_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sa_project_id_idx ON stage_acceptances(project_id);
CREATE INDEX IF NOT EXISTS sa_stage_code_idx ON stage_acceptances(stage_code);

-- 3. Acceptance Reservations — open items from "accepted with reservations"
CREATE TABLE IF NOT EXISTS acceptance_reservations (
  id SERIAL PRIMARY KEY,
  acceptance_id INTEGER NOT NULL REFERENCES stage_acceptances(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'open',  -- open / closed / overdue
  closed_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ar_project_id_idx ON acceptance_reservations(project_id);
CREATE INDEX IF NOT EXISTS ar_acceptance_id_idx ON acceptance_reservations(acceptance_id);
CREATE INDEX IF NOT EXISTS ar_status_idx ON acceptance_reservations(status);

-- 4. Client Commitments — promises to clients tracked across stages
CREATE TABLE IF NOT EXISTS client_commitments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code_created TEXT NOT NULL,
  commitment_text TEXT NOT NULL,
  committed_by_user_id INTEGER REFERENCES users(id),
  committed_date TIMESTAMP NOT NULL DEFAULT NOW(),
  delivery_stage_code TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open / delivered / overdue / cancelled
  delivered_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cc_project_id_idx ON client_commitments(project_id);
CREATE INDEX IF NOT EXISTS cc_status_idx ON client_commitments(status);

-- 5. Evidence Requests — formal requests between teams
CREATE TABLE IF NOT EXISTS evidence_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  requested_by_user_id INTEGER REFERENCES users(id),
  requested_from_department TEXT NOT NULL,
  requested_from_user_id INTEGER REFERENCES users(id),
  description TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'requested',  -- requested / uploaded / overdue / waived
  evidence_url TEXT,
  fulfilled_date TIMESTAMP,
  linked_dependency_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS er_project_id_idx ON evidence_requests(project_id);
CREATE INDEX IF NOT EXISTS er_status_idx ON evidence_requests(status);
CREATE INDEX IF NOT EXISTS er_stage_code_idx ON evidence_requests(stage_code);

-- 6. Project Queries — structured queries with routing
CREATE TABLE IF NOT EXISTS project_queries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  query_type TEXT NOT NULL,  -- technical / commercial / compliance / quality / design
  raised_by_user_id INTEGER REFERENCES users(id),
  raised_by_department TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id),
  assigned_to_department TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',  -- normal / urgent
  status TEXT NOT NULL DEFAULT 'open',  -- open / in_progress / answered / closed
  response_text TEXT,
  responded_by_user_id INTEGER REFERENCES users(id),
  responded_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pq_project_id_idx ON project_queries(project_id);
CREATE INDEX IF NOT EXISTS pq_status_idx ON project_queries(status);
CREATE INDEX IF NOT EXISTS pq_stage_code_idx ON project_queries(stage_code);

-- 7. Client Updates — weekly client communication records
CREATE TABLE IF NOT EXISTS client_updates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  update_number INTEGER NOT NULL DEFAULT 1,
  last_client_update_date TIMESTAMP,
  next_client_update_due_date TIMESTAMP,
  client_update_status TEXT NOT NULL DEFAULT 'draft',  -- draft / pending_review / approved / sent / overdue
  progress_summary_text TEXT,
  completed_this_period_text TEXT,
  next_7_days_text TEXT,
  blockers_text TEXT,
  client_actions_required_text TEXT,
  attachment_urls JSONB DEFAULT '[]',
  client_update_sent_by INTEGER REFERENCES users(id),
  reviewer_user_id INTEGER REFERENCES users(id),
  sent_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cu_project_id_idx ON client_updates(project_id);
CREATE INDEX IF NOT EXISTS cu_status_idx ON client_updates(client_update_status);
