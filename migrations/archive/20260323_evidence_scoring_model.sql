DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_type') THEN
    CREATE TYPE evidence_type AS ENUM ('document', 'photo', 'form', 'structured_field', 'sign_off', 'linked_record');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS evidence_requirement_definitions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  completion_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  requirement_key TEXT NOT NULL,
  label TEXT NOT NULL,
  evidence_type evidence_type NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  weight REAL NOT NULL DEFAULT 1,
  min_count INTEGER NOT NULL DEFAULT 1,
  threshold_percent REAL,
  config_json JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_requirement_lookup ON evidence_requirement_definitions(completion_type, source_type, source_ref, project_id, active);

CREATE TABLE IF NOT EXISTS evidence_collected_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  completion_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  requirement_key TEXT,
  evidence_type evidence_type NOT NULL,
  title TEXT,
  value_ref TEXT,
  value_json JSONB,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  uploaded_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_collected_lookup ON evidence_collected_items(project_id, completion_type, source_type, source_ref);

CREATE TABLE IF NOT EXISTS evidence_evaluations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  completion_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  threshold_percent REAL NOT NULL,
  score_percent REAL NOT NULL,
  total_required INTEGER NOT NULL,
  total_present INTEGER NOT NULL,
  missing_items_json JSONB,
  pass BOOLEAN NOT NULL,
  evaluated_by_user_id INTEGER REFERENCES users(id),
  evaluated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_evaluations_lookup ON evidence_evaluations(project_id, completion_type, source_type, source_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_override_records (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  completion_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  score_percent REAL NOT NULL,
  threshold_percent REAL NOT NULL,
  reason TEXT NOT NULL,
  authorized_by_user_id INTEGER NOT NULL REFERENCES users(id),
  authorized_by_name TEXT,
  authorized_by_role TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_override_lookup ON evidence_override_records(project_id, completion_type, source_type, source_ref, created_at DESC);
