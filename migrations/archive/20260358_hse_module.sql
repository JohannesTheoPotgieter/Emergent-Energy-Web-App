-- Step C3: HSE module — incidents and corrective actions
-- All new tables, zero impact on existing quality module

CREATE TABLE IF NOT EXISTS hse_incidents (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  site_id INTEGER REFERENCES sites(id),
  incident_date DATE NOT NULL,
  incident_type TEXT NOT NULL,     -- 'near_miss', 'first_aid', 'medical', 'lost_time', 'fatality', 'environmental', 'property_damage'
  severity TEXT NOT NULL,          -- 'low', 'medium', 'high', 'critical'
  description TEXT NOT NULL,
  reported_by_user_id INTEGER REFERENCES users(id),
  location TEXT,
  root_cause TEXT,
  immediate_actions TEXT,
  status TEXT DEFAULT 'open',      -- 'open', 'investigating', 'corrective_action', 'closed'
  evidence_link TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,       -- 'hse_incident', 'ncr', 'snag', 'audit', 'inspection'
  source_id INTEGER NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id),
  due_date DATE,
  status TEXT DEFAULT 'open',      -- 'open', 'in_progress', 'completed', 'verified', 'overdue'
  completion_date DATE,
  evidence_link TEXT,
  verified_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);
