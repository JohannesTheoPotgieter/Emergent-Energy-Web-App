-- Engineering drawing register — tracks design documents through revision lifecycle

CREATE TABLE IF NOT EXISTS drawing_register (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  drawing_number TEXT NOT NULL,
  title TEXT NOT NULL,
  discipline TEXT,              -- 'electrical', 'structural', 'mechanical', 'civil', 'architectural'
  current_revision TEXT DEFAULT 'A',
  revision_date DATE,
  status TEXT DEFAULT 'draft',  -- 'draft', 'for_review', 'for_approval', 'approved', 'ifc', 'as_built', 'superseded'
  author_user_id INTEGER REFERENCES users(id),
  reviewer_user_id INTEGER REFERENCES users(id),
  approver_user_id INTEGER REFERENCES users(id),
  sharepoint_link TEXT,
  sheet_size TEXT,              -- 'A0', 'A1', 'A2', 'A3', 'A4'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drawing_revisions (
  id SERIAL PRIMARY KEY,
  drawing_id INTEGER NOT NULL REFERENCES drawing_register(id),
  revision TEXT NOT NULL,
  revision_date DATE NOT NULL,
  description TEXT,
  revised_by_user_id INTEGER REFERENCES users(id),
  sharepoint_link TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
