-- Migration: Commissioning workbook source and snapshot tables
-- Purpose: Support workbook-driven commissioning control tower
-- Transaction: Safe to run inside a transaction
-- Rollback: Included at bottom (commented)

-- ============================================================
-- FORWARD MIGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS commissioning_sources (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  source_type TEXT NOT NULL DEFAULT 'sharepoint',        -- 'sharepoint' | 'manual_upload' | 'local_path'
  drive_id TEXT,                                          -- SharePoint drive ID
  item_id TEXT,                                           -- SharePoint file item ID
  file_path TEXT,                                         -- fallback local/manual path
  workbook_url TEXT,                                      -- direct link to open workbook
  folder_url TEXT,                                        -- link to shared folder
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id),
  UNIQUE(project_id)                                      -- one source per project
);

CREATE TABLE IF NOT EXISTS commissioning_snapshots (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  source_id INTEGER REFERENCES commissioning_sources(id),
  source_etag TEXT,                                       -- etag at time of parse
  source_ctag TEXT,                                       -- ctag at time of parse
  source_modified_at TIMESTAMP,                           -- file modified timestamp
  parse_status TEXT NOT NULL DEFAULT 'pending',           -- 'pending' | 'success' | 'partial' | 'failed'
  parse_message TEXT,                                     -- human-readable parse result
  parsed_sections JSONB NOT NULL DEFAULT '[]'::jsonb,     -- array of parsed section objects
  parsed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_latest BOOLEAN NOT NULL DEFAULT true,                -- only one latest per project
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commissioning_snapshots_project
  ON commissioning_snapshots(project_id, is_latest);

CREATE INDEX IF NOT EXISTS idx_commissioning_sources_project
  ON commissioning_sources(project_id);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('commissioning_sources', 'commissioning_snapshots');
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'commissioning_sources' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'commissioning_snapshots' ORDER BY ordinal_position;

-- ============================================================
-- ROLLBACK MIGRATION
-- ============================================================
-- DROP INDEX IF EXISTS idx_commissioning_snapshots_project;
-- DROP INDEX IF EXISTS idx_commissioning_sources_project;
-- DROP TABLE IF EXISTS commissioning_snapshots;
-- DROP TABLE IF EXISTS commissioning_sources;
