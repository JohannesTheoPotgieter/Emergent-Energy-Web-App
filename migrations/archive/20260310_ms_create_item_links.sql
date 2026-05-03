CREATE TABLE IF NOT EXISTS ms_create_item_links (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_deep_link TEXT,
  source_title TEXT,
  source_sender_or_author TEXT,
  created_item_type TEXT NOT NULL,
  created_item_id INTEGER NOT NULL,
  category TEXT,
  project_behavior TEXT,
  suggested_values JSONB,
  chosen_values JSONB,
  override_reasons JSONB,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ms_create_item_links_source_ref_type_unique
  ON ms_create_item_links(source_type, source_ref, created_item_type);
