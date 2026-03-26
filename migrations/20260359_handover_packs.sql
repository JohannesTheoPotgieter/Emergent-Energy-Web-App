-- Step C4: Handover packs — client handover, practical completion, Matriarch, SSEG closeout
-- New tables, existing PD-PM handover (project_pd_pm_handover) stays untouched

CREATE TABLE IF NOT EXISTS handover_packs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  pack_type TEXT NOT NULL,         -- 'pd_to_pm', 'practical_completion', 'client_handover', 'matriarch_handover', 'sseg_closeout'
  checklist_status TEXT DEFAULT 'not_started', -- 'not_started', 'in_progress', 'complete', 'submitted', 'accepted', 'rejected'
  document_completeness_pct INTEGER DEFAULT 0,
  open_snags_count INTEGER DEFAULT 0,
  final_reviewer_user_id INTEGER REFERENCES users(id),
  client_submission_date DATE,
  client_acceptance_date DATE,
  matriarch_acceptance_date DATE,
  notes TEXT,
  status TEXT DEFAULT 'draft',     -- 'draft', 'in_progress', 'submitted', 'accepted', 'rejected'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS handover_checklist_items (
  id SERIAL PRIMARY KEY,
  handover_pack_id INTEGER NOT NULL REFERENCES handover_packs(id),
  item_name TEXT NOT NULL,
  category TEXT,                   -- 'document', 'inspection', 'approval', 'training', 'asset_transfer'
  required BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'pending',   -- 'pending', 'complete', 'not_applicable', 'waived'
  evidence_link TEXT,
  completed_by_user_id INTEGER REFERENCES users(id),
  completed_date TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sseg_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  item_type TEXT NOT NULL,         -- 'application', 'approval', 'inspection', 'certificate', 'connection'
  authority TEXT,
  reference_number TEXT,
  submitted_date DATE,
  expected_date DATE,
  actual_date DATE,
  status TEXT DEFAULT 'pending',   -- 'pending', 'submitted', 'approved', 'rejected', 'complete'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);
