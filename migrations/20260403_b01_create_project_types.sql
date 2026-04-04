-- Migration: 20260403_b01_create_project_types.sql
-- Phase B.1: Create core.project_types and core.project_type_parameter_definitions.
-- project_types is seeded with 6 types. parameter_definitions is empty (frontend-managed).
-- Additive only. No app code changes.
BEGIN;

-- -------------------------------------------------------
-- 1. core.project_types — 6 project technology types
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_types (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE core.project_types IS
  'Phase B.1: project technology type reference table. Seeded with 6 types.';

INSERT INTO core.project_types (code, name) VALUES
  ('GRID_TIED', 'Grid Tied'),
  ('BESS',      'BESS'),
  ('HYBRID',    'Hybrid'),
  ('WATER',     'Water'),
  ('AD_HOC',    'Ad Hoc'),
  ('OTHER',     'Other')
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------
-- 2. core.project_type_parameter_definitions
--    Empty table — parameter definitions are created and
--    maintained via frontend admin UI, not hardcoded.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_type_parameter_definitions (
  id              SERIAL PRIMARY KEY,
  project_type_id INTEGER NOT NULL REFERENCES core.project_types(id),
  parameter_code  TEXT NOT NULL,
  label           TEXT NOT NULL,
  data_type       TEXT NOT NULL,
  unit            TEXT,
  is_required     BOOLEAN NOT NULL DEFAULT false,
  default_value   TEXT,
  select_options  JSONB,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_type_id, parameter_code)
);

CREATE INDEX IF NOT EXISTS idx_param_defs_project_type_id
  ON core.project_type_parameter_definitions (project_type_id);

CREATE INDEX IF NOT EXISTS idx_param_defs_active
  ON core.project_type_parameter_definitions (project_type_id) WHERE is_active = true;

COMMENT ON TABLE core.project_type_parameter_definitions IS
  'Phase B.1: per-type parameter definitions managed via frontend admin UI. data_type: text, number, boolean, date, select. select_options: JSONB array for dropdown choices.';

COMMIT;
