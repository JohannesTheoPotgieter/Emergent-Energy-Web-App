-- Standup system improvements: unique constraint, timezone support, trend tracking
-- 1. Add unique constraint on standup_entries to prevent duplicate submissions
-- 2. Add deadline_timezone column to standup_schedules for timezone-aware late detection

-- Deduplicate any existing entries before adding unique constraint
-- Keeps the most recent entry (highest id) for each schedule+user+date combo
DELETE FROM standup_entries a
  USING standup_entries b
  WHERE a.schedule_id = b.schedule_id
    AND a.user_id = b.user_id
    AND a.standup_date = b.standup_date
    AND a.id < b.id;

-- Add unique constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'standup_entries_unique_schedule_user_date'
  ) THEN
    ALTER TABLE standup_entries
      ADD CONSTRAINT standup_entries_unique_schedule_user_date
      UNIQUE (schedule_id, user_id, standup_date);
  END IF;
END $$;

-- Add timezone column with South African default
ALTER TABLE standup_schedules
  ADD COLUMN IF NOT EXISTS deadline_timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg';
