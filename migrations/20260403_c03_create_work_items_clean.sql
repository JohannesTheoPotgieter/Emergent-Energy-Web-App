-- Migration: 20260403_c03_create_work_items_clean.sql
-- Phase C.2: Create core.work_items_clean — narrow 17-column spine.
-- Domain-specific fields remain in existing extension tables
-- (work_item_pm, work_item_engineering, work_item_scheduling).
-- Additive only. No app code changes. Existing work_items remains untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.work_items_clean — narrow spine
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.work_items_clean (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_work_item_id   INTEGER UNIQUE NOT NULL,
  work_package_id       BIGINT REFERENCES core.work_packages(id),
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  assigned_to_party_id  BIGINT REFERENCES core.parties(id),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'Not Started',
  priority              TEXT,
  start_date            DATE,
  end_date              DATE,
  percent_complete      REAL DEFAULT 0,
  is_milestone          BOOLEAN DEFAULT false,
  parent_id             BIGINT REFERENCES core.work_items_clean(id),
  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- 2. Indexes
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_items_clean_work_package_id
  ON core.work_items_clean (work_package_id);

CREATE INDEX IF NOT EXISTS idx_work_items_clean_project_instance_id
  ON core.work_items_clean (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_work_items_clean_assigned_to_party_id
  ON core.work_items_clean (assigned_to_party_id);

CREATE INDEX IF NOT EXISTS idx_work_items_clean_status
  ON core.work_items_clean (status);

CREATE INDEX IF NOT EXISTS idx_work_items_clean_parent_id
  ON core.work_items_clean (parent_id);

CREATE INDEX IF NOT EXISTS idx_work_items_clean_end_date
  ON core.work_items_clean (end_date);

COMMENT ON TABLE core.work_items_clean IS
  'Phase C.2: Narrow 17-column work item spine. Domain fields stay in extension tables (work_item_pm, work_item_engineering, work_item_scheduling). Legacy work_items remains untouched.';

COMMIT;
