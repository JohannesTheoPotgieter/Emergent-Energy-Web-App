-- Step C1: Construction module — site activities, snags, inspections, contractor assignments
-- All new tables, zero impact on existing data

CREATE TABLE IF NOT EXISTS site_activities (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  site_id INTEGER REFERENCES sites(id),
  activity_date DATE NOT NULL,
  activity_type TEXT NOT NULL,    -- 'daily_log', 'inspection', 'toolbox_talk', 'incident', 'material_receipt', 'permit'
  title TEXT NOT NULL,
  description TEXT,
  reported_by_user_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'open',     -- 'open', 'closed', 'flagged'
  weather TEXT,
  crew_count INTEGER,
  photos TEXT,                    -- JSON array of SharePoint links
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snags (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  site_id INTEGER REFERENCES sites(id),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'minor',   -- 'critical', 'major', 'minor', 'observation'
  location TEXT,
  reported_by_user_id INTEGER REFERENCES users(id),
  assigned_to_user_id INTEGER REFERENCES users(id),
  due_date DATE,
  status TEXT DEFAULT 'open',      -- 'open', 'in_progress', 'resolved', 'verified', 'closed'
  resolution TEXT,
  evidence_link TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_inspections (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  site_id INTEGER REFERENCES sites(id),
  inspection_type TEXT NOT NULL,   -- 'hold_point', 'witness_point', 'routine', 'final', 'joint_tenant'
  inspector_user_id INTEGER REFERENCES users(id),
  inspection_date DATE,
  result TEXT,                     -- 'pass', 'fail', 'conditional', 'pending'
  notes TEXT,
  evidence_link TEXT,
  linked_snag_ids TEXT,            -- JSON array of snag IDs created from failures
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contractor_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  counterparty_id INTEGER REFERENCES counterparties(id),
  scope TEXT,
  start_date DATE,
  end_date DATE,
  performance_rating INTEGER,     -- 1-5
  notes TEXT,
  status TEXT DEFAULT 'active',   -- 'active', 'completed', 'terminated'
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);
