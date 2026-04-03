-- Migration: 20260403_c05_create_work_item_dependencies_clean.sql
-- Phase C.3: Create core.work_item_dependencies_clean referencing work_items_clean.
-- Same schema as existing work_item_dependencies but FK-linked to clean model.
-- Additive only. No app code changes. Existing work_item_dependencies remains untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.work_item_dependencies_clean
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.work_item_dependencies_clean (
  id                BIGSERIAL PRIMARY KEY,
  predecessor_id    BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE,
  successor_id      BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE,
  dep_type          TEXT NOT NULL DEFAULT 'FS',
  lag_days          INTEGER DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- 2. Indexes
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_item_deps_clean_predecessor_id
  ON core.work_item_dependencies_clean (predecessor_id);

CREATE INDEX IF NOT EXISTS idx_work_item_deps_clean_successor_id
  ON core.work_item_dependencies_clean (successor_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_item_deps_clean_unique_pair
  ON core.work_item_dependencies_clean (predecessor_id, successor_id, dep_type);

COMMENT ON TABLE core.work_item_dependencies_clean IS
  'Phase C.3: Work item dependencies referencing core.work_items_clean. Same schema as existing work_item_dependencies but linked to clean model.';

COMMIT;
