-- ============================================================
-- Prompt 6: Task Migration Map + Extension Table Population
--
-- 1. Creates task_migration_map to track source → work_items mapping
-- 2. Extension tables (from Prompt 5) are populated by the backfill script
-- ============================================================

-- Migration tracking table
CREATE TABLE IF NOT EXISTS task_migration_map (
  id SERIAL PRIMARY KEY,
  old_table TEXT NOT NULL,
  old_id INTEGER NOT NULL,
  new_work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  migrated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(old_table, old_id)
);

CREATE INDEX idx_task_migration_map_old ON task_migration_map(old_table, old_id);
CREATE INDEX idx_task_migration_map_new ON task_migration_map(new_work_item_id);

COMMENT ON TABLE task_migration_map IS 'Tracks source table → work_items migration (Prompt 6)';
