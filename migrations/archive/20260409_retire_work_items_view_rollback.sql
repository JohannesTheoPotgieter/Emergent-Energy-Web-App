-- 20260409_retire_work_items_view_rollback.sql
-- Rollback: re-create the view architecture if the retirement migration
-- causes issues.
--
-- WARNING: This restores a KNOWN-BROKEN architecture where INSTEAD OF
-- triggers target core.work_items (which has an incompatible schema).
-- Only use this if the base-table approach causes worse problems.
--
-- Steps:
--   1. Rename work_items → _work_items_legacy
--   2. Create VIEW work_items selecting from _work_items_legacy
--   3. (Trigger functions are NOT recreated — they were broken)

DO $$ BEGIN
  -- Only run if work_items is currently a base table (not already a view)
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_items')
     AND NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'work_items')
  THEN
    -- Step 1: Rename table back to legacy name
    ALTER TABLE public.work_items RENAME TO _work_items_legacy;
    RAISE NOTICE '[rollback] Renamed work_items → _work_items_legacy';

    -- Step 2: Create view
    CREATE OR REPLACE VIEW public.work_items AS
      SELECT * FROM public._work_items_legacy;
    RAISE NOTICE '[rollback] Created VIEW public.work_items over _work_items_legacy';

    -- Step 3: Fix sequence
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'work_items_id_seq') THEN
      ALTER SEQUENCE work_items_id_seq OWNED BY public._work_items_legacy.id;
    END IF;

    RAISE NOTICE '[rollback] ✓ Rollback complete — work_items is now a VIEW again';
    RAISE NOTICE '[rollback] WARNING: INSTEAD OF triggers are NOT restored (they were broken)';
    RAISE NOTICE '[rollback] WARNING: Writes to work_items will fail without simple-passthrough triggers';
  ELSE
    RAISE NOTICE '[rollback] work_items is not a base table — nothing to rollback';
  END IF;
END $$;
