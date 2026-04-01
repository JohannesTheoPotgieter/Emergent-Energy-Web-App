-- Migration: Commissioning workbook source and snapshot tables
-- Purpose: Support workbook-driven commissioning control tower
-- Transaction: Safe to run inside a transaction (DDL only, no data modifications)
-- Rollback: See 20260401_commissioning_workbook_source_rollback.sql

-- ============================================================
-- FORWARD MIGRATION
-- ============================================================

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

CREATE INDEX IF NOT EXISTS idx_commissioning_snapshots_project
  ON commissioning_snapshots(project_id, is_latest);

CREATE INDEX IF NOT EXISTS idx_commissioning_sources_project
  ON commissioning_sources(project_id);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- 1. Tables exist (expect 2 rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('commissioning_sources', 'commissioning_snapshots');
--
-- 2. commissioning_sources columns (expect 13):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'commissioning_sources'
--   ORDER BY ordinal_position;
--
-- 3. commissioning_snapshots columns (expect 12):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'commissioning_snapshots'
--   ORDER BY ordinal_position;
--
-- 4. Indexes (expect 2):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('commissioning_sources', 'commissioning_snapshots')
--   AND indexname LIKE 'idx_commissioning%';
--
-- 5. Unique constraint on project_id:
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_name = 'commissioning_sources' AND constraint_type = 'UNIQUE';
--
-- Verification Report:
--   Tables created: 2/2
--   commissioning_sources columns: 13/13
--   commissioning_snapshots columns: 12/12
--   Indexes: 2/2
--   Unique constraint: present
