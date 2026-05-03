-- Task Management & Standup System Migration
-- Adds tables for standup scheduling, entries, task tags, time tracking
-- Adds columns to work_items for estimates, categories, and recurrence

-- Enums
DO $$ BEGIN
  CREATE TYPE task_tag_category AS ENUM ('BUG', 'IMPROVEMENT', 'FEATURE', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE standup_cadence AS ENUM ('DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE standup_mood AS ENUM ('great', 'good', 'okay', 'struggling', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Standup schedules
CREATE TABLE IF NOT EXISTS standup_schedules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  team_label TEXT,
  project_id INTEGER REFERENCES project_info(id),
  cadence standup_cadence NOT NULL DEFAULT 'EVERY_2_DAYS',
  cadence_days INTEGER NOT NULL DEFAULT 2,
  anchor_date TEXT NOT NULL,
  deadline_time TEXT DEFAULT '10:00',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Standup participants
CREATE TABLE IF NOT EXISTS standup_participants (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES standup_schedules(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  is_required BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Standup entries
CREATE TABLE IF NOT EXISTS standup_entries (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES standup_schedules(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  standup_date TEXT NOT NULL,
  what_i_did TEXT,
  what_im_doing TEXT,
  blockers TEXT,
  mood standup_mood,
  is_late BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Task tags
CREATE TABLE IF NOT EXISTS task_tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6366f1',
  category task_tag_category NOT NULL DEFAULT 'CUSTOM',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Work item ↔ tag junction
CREATE TABLE IF NOT EXISTS work_item_tags (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT work_item_tags_unique UNIQUE (work_item_id, tag_id)
);

-- Task time entries
CREATE TABLE IF NOT EXISTS task_time_entries (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  duration_minutes INTEGER NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add columns to work_items (estimate, category, recurrence aligned with mytool_tasks pattern)
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_category TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_days_of_week TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_end_date TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER;

-- Seed default tags
INSERT INTO task_tags (name, color, category) VALUES
  ('Bug', '#ef4444', 'BUG'),
  ('Improvement', '#f59e0b', 'IMPROVEMENT'),
  ('Feature', '#22c55e', 'FEATURE'),
  ('Security', '#dc2626', 'CUSTOM'),
  ('Performance', '#8b5cf6', 'CUSTOM'),
  ('UX', '#06b6d4', 'CUSTOM'),
  ('Tech Debt', '#64748b', 'CUSTOM'),
  ('Critical', '#dc2626', 'CUSTOM'),
  ('High Priority', '#f97316', 'CUSTOM'),
  ('Low Priority', '#94a3b8', 'CUSTOM')
ON CONFLICT (name) DO NOTHING;
