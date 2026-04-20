-- ============================================================
-- Prompt 7: Repoint Task Sub-tables → work_items
--
-- Adds work_item_id to each task sub-table (task_comments, task_checklists,
-- task_attachments, task_activity_log, task_watchers, task_deliverables).
--
-- Does NOT drop old taskId columns (dual-write period).
-- ============================================================

-- 1. task_comments
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_comments_work_item_id ON task_comments(work_item_id);

-- 2. task_checklists
ALTER TABLE task_checklists
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_checklists_work_item_id ON task_checklists(work_item_id);

-- 3. task_attachments
ALTER TABLE task_attachments
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_attachments_work_item_id ON task_attachments(work_item_id);

-- 4. task_activity_log
ALTER TABLE task_activity_log
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_activity_log_work_item_id ON task_activity_log(work_item_id);

-- 5. task_watchers
ALTER TABLE task_watchers
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_watchers_work_item_id ON task_watchers(work_item_id);

-- 6. task_deliverables
ALTER TABLE task_deliverables
  ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_deliverables_work_item_id ON task_deliverables(work_item_id);

COMMENT ON COLUMN task_comments.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
COMMENT ON COLUMN task_checklists.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
COMMENT ON COLUMN task_attachments.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
COMMENT ON COLUMN task_activity_log.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
COMMENT ON COLUMN task_watchers.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
COMMENT ON COLUMN task_deliverables.work_item_id IS 'FK to work_items (Prompt 7); replaces polymorphic task_id';
