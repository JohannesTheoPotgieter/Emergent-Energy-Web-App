-- Add missing deleted_at and deleted_by columns to standup_schedules
-- The Drizzle schema references these columns but the migration was never created,
-- causing all standup queries to fail with "column deleted_at does not exist".

ALTER TABLE standup_schedules
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE standup_schedules
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id);
