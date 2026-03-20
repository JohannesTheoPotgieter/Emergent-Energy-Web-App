-- ============================================================
-- Prompt 5: Create work_item extension tables (lean core design)
--
-- Creates 3 extension tables for work_items:
--   - work_item_pm: PM/tracking/approval columns
--   - work_item_engineering: import provenance / WBS columns
--   - work_item_scheduling: calendar/recurrence/baseline columns
--
-- Each has a 1:1 relationship via work_item_id UNIQUE FK.
-- No data is moved. No columns are dropped from work_items.
-- ============================================================

-- 1. PM Extension
CREATE TABLE IF NOT EXISTS work_item_pm (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE UNIQUE,
  duration INTEGER,
  percent_complete REAL DEFAULT 0,
  expected_pct_complete REAL,
  phase TEXT,
  is_milestone BOOLEAN DEFAULT FALSE,
  indent_level INTEGER DEFAULT 0,
  owner_name TEXT,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  hold_reason TEXT,
  blocked_type TEXT,
  blocker_reason TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  tracking_rag TEXT,
  task_type_tag TEXT,
  sub_project_name TEXT,
  completed_at TIMESTAMP,
  linked_plan_item_id INTEGER,
  linked_deliverable_id INTEGER,
  linked_quality_item_instance_id INTEGER
);

CREATE INDEX idx_work_item_pm_work_item_id ON work_item_pm(work_item_id);

-- 2. Engineering Extension
CREATE TABLE IF NOT EXISTS work_item_engineering (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE UNIQUE,
  wbs_code TEXT,
  outline_number TEXT,
  legacy_table TEXT,
  legacy_id INTEGER,
  source_row INTEGER,
  source_sheet TEXT,
  import_run_id INTEGER
);

CREATE INDEX idx_work_item_engineering_work_item_id ON work_item_engineering(work_item_id);

-- 3. Scheduling Extension
CREATE TABLE IF NOT EXISTS work_item_scheduling (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE UNIQUE,
  scheduled_date TEXT,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  estimate_minutes INTEGER,
  task_category TEXT,
  baseline_start TEXT,
  baseline_end TEXT,
  baseline_duration INTEGER,
  task_mode TEXT DEFAULT 'auto',
  actual_start TEXT,
  actual_end TEXT,
  actual_duration INTEGER,
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_frequency TEXT,
  recurrence_interval INTEGER DEFAULT 1,
  recurrence_days_of_week TEXT,
  recurrence_end_date TEXT,
  recurrence_parent_id INTEGER
);

CREATE INDEX idx_work_item_scheduling_work_item_id ON work_item_scheduling(work_item_id);

-- Add comments documenting the extension pattern
COMMENT ON TABLE work_item_pm IS 'Extension: PM/tracking/approval fields for work_items (1:1 via work_item_id)';
COMMENT ON TABLE work_item_engineering IS 'Extension: import provenance and WBS fields for work_items (1:1 via work_item_id)';
COMMENT ON TABLE work_item_scheduling IS 'Extension: calendar/recurrence/baseline fields for work_items (1:1 via work_item_id)';
