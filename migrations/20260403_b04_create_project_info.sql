-- Migration: 20260403_b04_create_project_info.sql
-- Phase B.3: Create core.project_info (link table) and core.project_info_parameter_values (EAV).
-- core.project_info links a project_instance to a project_type.
-- core.project_info_parameter_values stores actual parameter values per project,
-- reading definitions from core.project_type_parameter_definitions (B.1).
-- No fixed technical columns — all attributes go through the EAV pattern.
-- Additive only. No app code changes. Legacy public.project_info remains untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.project_info — one row per project instance
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_info (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL UNIQUE REFERENCES core.project_instances(id),
  project_type_id       INTEGER REFERENCES core.project_types(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_info_project_type_id
  ON core.project_info (project_type_id);

COMMENT ON TABLE core.project_info IS
  'Phase B.3: per-project info linking project_instance to project_type. All technical/financial attributes stored via project_info_parameter_values (EAV).';

-- -------------------------------------------------------
-- 2. core.project_info_parameter_values — EAV value store
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_info_parameter_values (
  id                      BIGSERIAL PRIMARY KEY,
  project_info_id         BIGINT NOT NULL REFERENCES core.project_info(id),
  parameter_definition_id INTEGER NOT NULL REFERENCES core.project_type_parameter_definitions(id),
  value_text              TEXT,
  value_number            NUMERIC,
  value_boolean           BOOLEAN,
  value_date              DATE,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_info_id, parameter_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_param_values_project_info_id
  ON core.project_info_parameter_values (project_info_id);

CREATE INDEX IF NOT EXISTS idx_param_values_parameter_definition_id
  ON core.project_info_parameter_values (parameter_definition_id);

COMMENT ON TABLE core.project_info_parameter_values IS
  'Phase B.3: EAV value store for project parameters. One row per (project, parameter_definition). Use value_text/value_number/value_boolean/value_date based on parameter data_type.';

COMMIT;
