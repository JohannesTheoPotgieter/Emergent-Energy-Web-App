-- 20260409_retire_work_items_view.sql
-- Purpose: Retire the writable-view architecture for work_items.
--
-- Root cause: public.work_items was converted to a VIEW over _work_items_legacy,
-- with INSTEAD OF triggers routing writes to core.work_items (which has an
-- incompatible 24-column schema vs 60+ expected). This breaks ALL writes.
--
-- Fix: drop the view and triggers, rename _work_items_legacy back to work_items,
-- making it a directly-writable base table again.
--
-- Safety:
--   * ALTER TABLE RENAME preserves the table OID — all 40+ FK constraints,
--     all indexes, all sequences follow the OID automatically.
--   * Every step uses IF EXISTS guards for idempotency.
--   * Date type conversions use safe CASE expressions (invalid → NULL).
--   * No data is deleted or moved.
--
-- Rollback: see 20260409_retire_work_items_view_rollback.sql

-- =====================================================================
-- STEP 0: Save and drop dependent views that reference work_items
-- (priority_derived_metrics references work_items via subqueries)
-- =====================================================================
DROP VIEW IF EXISTS public.priority_derived_metrics;

-- =====================================================================
-- STEP 1: Drop INSTEAD OF triggers on the work_items view
-- =====================================================================
DROP TRIGGER IF EXISTS _work_items_view_update_trigger ON public.work_items;
DROP TRIGGER IF EXISTS _work_items_view_insert_trigger ON public.work_items;
DROP TRIGGER IF EXISTS _work_items_view_delete_trigger ON public.work_items;

-- =====================================================================
-- STEP 2: Drop trigger functions
-- =====================================================================
DROP FUNCTION IF EXISTS public._work_items_view_update() CASCADE;
DROP FUNCTION IF EXISTS public._work_items_view_insert() CASCADE;
DROP FUNCTION IF EXISTS public._work_items_view_delete() CASCADE;

-- =====================================================================
-- STEP 3: Drop the VIEW (only if it IS a view, not a table)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'work_items') THEN
    DROP VIEW public.work_items;
    RAISE NOTICE '[migration] Dropped VIEW public.work_items';
  ELSE
    RAISE NOTICE '[migration] public.work_items is not a VIEW — skipping drop';
  END IF;
END $$;

-- =====================================================================
-- STEP 4: Rename _work_items_legacy → work_items (if legacy table exists
--         and work_items does not exist as a table)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_work_items_legacy')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_items')
  THEN
    ALTER TABLE public._work_items_legacy RENAME TO work_items;
    RAISE NOTICE '[migration] Renamed _work_items_legacy → work_items';
  ELSIF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_items') THEN
    RAISE NOTICE '[migration] work_items already exists as a table — no rename needed';
  ELSE
    RAISE NOTICE '[migration] WARNING: neither _work_items_legacy nor work_items table found!';
  END IF;
END $$;

-- =====================================================================
-- STEP 5: Fix sequence ownership
-- Ensure work_items.id uses a proper sequence with correct ownership.
-- =====================================================================
DO $$
DECLARE
  seq_exists BOOLEAN;
  legacy_seq_exists BOOLEAN;
  max_id BIGINT;
BEGIN
  -- Check which sequences exist
  SELECT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'work_items_id_seq')
    INTO seq_exists;
  SELECT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = '_work_items_legacy_id_seq')
    INTO legacy_seq_exists;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_items') THEN
    RAISE NOTICE '[migration] No work_items table — skipping sequence fix';
    RETURN;
  END IF;

  -- Get max id for resyncing
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM public.work_items;

  IF seq_exists THEN
    -- Preferred: use work_items_id_seq
    ALTER SEQUENCE work_items_id_seq OWNED BY public.work_items.id;
    ALTER TABLE public.work_items ALTER COLUMN id SET DEFAULT nextval('work_items_id_seq'::regclass);
    IF max_id > 0 THEN
      PERFORM setval('work_items_id_seq', max_id, true);
    END IF;
    RAISE NOTICE '[migration] Attached work_items_id_seq to work_items.id (max: %)', max_id;
  ELSIF legacy_seq_exists THEN
    -- Fallback: rename legacy sequence
    ALTER SEQUENCE _work_items_legacy_id_seq RENAME TO work_items_id_seq;
    ALTER SEQUENCE work_items_id_seq OWNED BY public.work_items.id;
    ALTER TABLE public.work_items ALTER COLUMN id SET DEFAULT nextval('work_items_id_seq'::regclass);
    IF max_id > 0 THEN
      PERFORM setval('work_items_id_seq', max_id, true);
    END IF;
    RAISE NOTICE '[migration] Renamed _work_items_legacy_id_seq → work_items_id_seq (max: %)', max_id;
  ELSE
    -- Create fresh sequence
    CREATE SEQUENCE work_items_id_seq;
    IF max_id > 0 THEN
      PERFORM setval('work_items_id_seq', max_id, true);
    END IF;
    ALTER TABLE public.work_items ALTER COLUMN id SET DEFAULT nextval('work_items_id_seq'::regclass);
    ALTER SEQUENCE work_items_id_seq OWNED BY public.work_items.id;
    RAISE NOTICE '[migration] Created new work_items_id_seq (max: %)', max_id;
  END IF;
END $$;

-- =====================================================================
-- STEP 6: Rename legacy-prefixed indexes back to canonical names
-- (cosmetic, but prevents confusion and aligns with ORM expectations)
-- =====================================================================
ALTER INDEX IF EXISTS _work_items_legacy_pkey RENAME TO work_items_pkey;
ALTER INDEX IF EXISTS _idx_work_items_legacy_deleted RENAME TO idx_work_items_deleted;
ALTER INDEX IF EXISTS _idx_work_items_legacy_external_ref RENAME TO idx_work_items_external_ref;
ALTER INDEX IF EXISTS _idx_work_items_legacy_owner RENAME TO idx_work_items_owner;
ALTER INDEX IF EXISTS _idx_work_items_legacy_project_id RENAME TO idx_work_items_project_id;
ALTER INDEX IF EXISTS _idx_work_items_legacy_workstream RENAME TO idx_work_items_workstream;
ALTER INDEX IF EXISTS _work_items_legacy_external_ref_key RENAME TO work_items_external_ref_key;

-- =====================================================================
-- STEP 7: Convert TEXT date columns to DATE (idempotent)
-- These may still be TEXT if the type-conversion migration failed
-- when work_items was a VIEW.
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'start_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN start_date TYPE date
      USING CASE WHEN start_date IS NULL OR start_date = '' THEN NULL
                 WHEN start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN start_date::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted start_date TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'end_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN end_date TYPE date
      USING CASE WHEN end_date IS NULL OR end_date = '' THEN NULL
                 WHEN end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN end_date::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted end_date TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'scheduled_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN scheduled_date TYPE date
      USING CASE WHEN scheduled_date IS NULL OR scheduled_date = '' THEN NULL
                 WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$' THEN scheduled_date::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted scheduled_date TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'baseline_start' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN baseline_start TYPE date
      USING CASE WHEN baseline_start IS NULL OR baseline_start = '' THEN NULL
                 WHEN baseline_start ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_start::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted baseline_start TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'baseline_end' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN baseline_end TYPE date
      USING CASE WHEN baseline_end IS NULL OR baseline_end = '' THEN NULL
                 WHEN baseline_end ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_end::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted baseline_end TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'actual_start' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN actual_start TYPE date
      USING CASE WHEN actual_start IS NULL OR actual_start = '' THEN NULL
                 WHEN actual_start ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_start::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted actual_start TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'actual_end' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN actual_end TYPE date
      USING CASE WHEN actual_end IS NULL OR actual_end = '' THEN NULL
                 WHEN actual_end ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_end::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted actual_end TEXT → DATE';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_items'
      AND column_name = 'recurrence_end_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE work_items ALTER COLUMN recurrence_end_date TYPE date
      USING CASE WHEN recurrence_end_date IS NULL OR recurrence_end_date = '' THEN NULL
                 WHEN recurrence_end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN recurrence_end_date::date
                 ELSE NULL END;
    RAISE NOTICE '[migration] Converted recurrence_end_date TEXT → DATE';
  END IF;
END $$;

-- =====================================================================
-- STEP 8: Add any ORM columns that may be missing on the legacy table
-- (idempotent — ADD COLUMN IF NOT EXISTS)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_items') THEN
    -- Core ORM columns that might be missing on _work_items_legacy
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS workstream TEXT NOT NULL DEFAULT 'PM';
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'UI';
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_category TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_days_of_week TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS hold_reason TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocked_type TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_deliverable_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS tracking_rag TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_type_tag TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pd_ticket_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS bucket TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pinned_today BOOLEAN DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pinned_week BOOLEAN DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_email_id TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_email_subject TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS next_step TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS definition_of_done TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completion_note TEXT;
    RAISE NOTICE '[migration] Ensured all ORM columns exist on work_items';
  END IF;
END $$;

-- =====================================================================
-- STEP 9: Ensure ORM-expected indexes exist
-- =====================================================================
CREATE INDEX IF NOT EXISTS work_items_project_id_idx ON work_items(project_id);
CREATE INDEX IF NOT EXISTS work_items_owner_user_id_idx ON work_items(owner_user_id);
CREATE INDEX IF NOT EXISTS work_items_status_idx ON work_items(status);
CREATE INDEX IF NOT EXISTS work_items_end_date_idx ON work_items(end_date);
CREATE INDEX IF NOT EXISTS work_items_parent_id_idx ON work_items(parent_id);

-- =====================================================================
-- STEP 10: Recreate priority_derived_metrics view (dropped in Step 0)
-- Now references the base table work_items instead of the old view.
-- Wrapped in exception handler in case dependent tables don't exist.
-- =====================================================================
DO $$ BEGIN
  CREATE OR REPLACE VIEW priority_derived_metrics AS
  SELECT
    cp.id AS priority_id,
    COUNT(DISTINCT pp.project_id) AS project_count,
    COUNT(DISTINCT CASE
      WHEN LOWER(pes.rag_status) IN ('red') THEN pp.project_id
    END) AS at_risk_project_count,
    CASE
      WHEN bool_or(LOWER(pes.rag_status) = 'red') THEN 'critical'
      WHEN bool_or(LOWER(pes.rag_status) IN ('amber', 'orange')) THEN 'at_risk'
      WHEN COUNT(DISTINCT pp.project_id) = 0 THEN NULL
      ELSE 'healthy'
    END AS derived_health,
    COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0) AS total_revenue,
    COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_cos,
    COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0)
      - COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_gp,
    COALESCE(AVG(CAST(dpk.avg_actual_pct_complete AS NUMERIC)), 0) AS avg_progress,
    (SELECT COUNT(*) FROM work_items wi
     WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
     AND (LOWER(wi.status) LIKE '%block%')
     AND wi.deleted_at IS NULL) AS blocker_count,
    (SELECT COUNT(*) FROM work_items wi
     WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
     AND LOWER(wi.status) NOT IN ('complete', 'completed', 'done', 'cancelled', 'canceled', 'qc approved')
     AND wi.deleted_at IS NULL) AS open_task_count
  FROM mytool_company_priorities cp
  LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
  LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
  LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
  GROUP BY cp.id;
  RAISE NOTICE '[migration] ✓ Recreated priority_derived_metrics view';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[migration] priority_derived_metrics recreation skipped: %', SQLERRM;
END $$;

-- =====================================================================
-- STEP 11: Verify final state
-- =====================================================================
DO $$
DECLARE
  tbl_type TEXT;
BEGIN
  SELECT table_type INTO tbl_type
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'work_items';

  IF tbl_type = 'BASE TABLE' THEN
    RAISE NOTICE '[migration] ✓ public.work_items is now a BASE TABLE';
  ELSE
    RAISE WARNING '[migration] ✗ public.work_items is NOT a BASE TABLE (found: %)', COALESCE(tbl_type, 'MISSING');
  END IF;

  -- Verify no orphaned triggers
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE '_work_items_view_%') THEN
    RAISE WARNING '[migration] ✗ Orphaned _work_items_view_* functions still exist';
  ELSE
    RAISE NOTICE '[migration] ✓ No orphaned trigger functions';
  END IF;
END $$;
