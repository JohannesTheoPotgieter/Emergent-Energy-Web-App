-- Catch-up of the production hotfix already applied manually on 2026-04-28.
-- The legacy `task_activity_log.task_id` column (carried over from the
-- pre-work_items merge) was NOT NULL on production but is no longer written
-- by any application code. Inserts from the new bulk PD-task spawn flow
-- (task #108) failed because Drizzle never supplies a value for it.
--
-- Idempotent: no-op if the column is already nullable, or if the legacy
-- column has been dropped entirely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_activity_log'
      AND column_name = 'task_id'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.task_activity_log ALTER COLUMN task_id DROP NOT NULL';
  END IF;
END $$;
