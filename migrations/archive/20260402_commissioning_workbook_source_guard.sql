-- Migration: Guard commissioning workbook schema in partially-migrated environments
-- Purpose: Ensure commissioning dashboard tables/columns/indexes exist without data loss.

CREATE TABLE IF NOT EXISTS commissioning_sources (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  source_type TEXT NOT NULL DEFAULT 'sharepoint',
  source_format TEXT NOT NULL DEFAULT 'commissioning_workbook',
  drive_id TEXT,
  item_id TEXT,
  file_path TEXT,
  workbook_url TEXT,
  folder_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id),
  UNIQUE(project_id)
);

CREATE TABLE IF NOT EXISTS commissioning_snapshots (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  source_id INTEGER REFERENCES commissioning_sources(id),
  source_etag TEXT,
  source_ctag TEXT,
  source_modified_at TIMESTAMP,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_message TEXT,
  parsed_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_latest BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE commissioning_sources
  ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'commissioning_workbook';

ALTER TABLE commissioning_snapshots
  ADD COLUMN IF NOT EXISTS parsed_sections JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_commissioning_snapshots_project
  ON commissioning_snapshots(project_id, is_latest);

CREATE INDEX IF NOT EXISTS idx_commissioning_sources_project
  ON commissioning_sources(project_id);
