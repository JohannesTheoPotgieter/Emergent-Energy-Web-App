-- =============================================================================
-- Migration: Alter snapshotRunId FK constraints to ON DELETE SET NULL
-- Date: 2026-03-31
-- Risk: LOW — FK constraints already exist (migration 20260333). This only
--   changes the ON DELETE behavior from RESTRICT to SET NULL.
--
-- Background:
--   Migration 20260333_temporal_financial_columns.sql added snapshot_run_id
--   columns with REFERENCES smart_import_runs(id) but no ON DELETE clause
--   (defaulting to RESTRICT). This migration changes to SET NULL so that
--   deleting a snapshot run doesn't block; it just nulls out the reference.
--
-- Tables affected (8 total):
--   program_expense, program_inflows, cashflow_points,
--   finance_revenue_monthly, finance_cos_monthly,
--   project_revenue_summary, normalized_cost_lines, normalized_revenue_lines
--
-- No orphan cleanup needed: FK integrity has been enforced since migration 20260333.
-- Transaction: CAN run inside a transaction.
-- =============================================================================

-- ─── Step 1: Quarantine check (verify no orphans exist) ─────────────────────

CREATE TABLE IF NOT EXISTS snapshot_run_id_orphan_audit (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  orphan_count INTEGER NOT NULL,
  checked_at TIMESTAMP DEFAULT NOW()
);

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'program_expense', 'program_inflows', 'cashflow_points',
    'finance_revenue_monthly', 'finance_cos_monthly',
    'project_revenue_summary', 'normalized_cost_lines', 'normalized_revenue_lines'
  ];
  tbl TEXT;
  orphan_cnt INT;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I t WHERE t.snapshot_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM smart_import_runs s WHERE s.id = t.snapshot_run_id)',
      tbl
    ) INTO orphan_cnt;

    INSERT INTO snapshot_run_id_orphan_audit (table_name, orphan_count)
    VALUES (tbl, orphan_cnt);

    IF orphan_cnt > 0 THEN
      RAISE WARNING 'Table % has % orphaned snapshot_run_id references — nulling them out', tbl, orphan_cnt;
      EXECUTE format(
        'UPDATE %I SET snapshot_run_id = NULL WHERE snapshot_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM smart_import_runs s WHERE s.id = %I.snapshot_run_id)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ─── Step 2: Drop existing FK constraints and re-add with ON DELETE SET NULL ─
-- PostgreSQL names auto-generated FK constraints as {table}_{column}_fkey.
-- We drop IF EXISTS to handle cases where the constraint name differs.

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'program_expense', 'program_inflows', 'cashflow_points',
    'finance_revenue_monthly', 'finance_cos_monthly',
    'project_revenue_summary', 'normalized_cost_lines', 'normalized_revenue_lines'
  ];
  tbl TEXT;
  constraint_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Find the actual constraint name for this table's snapshot_run_id FK
    SELECT tc.constraint_name INTO constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = tbl
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name = 'snapshot_run_id'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, constraint_name);
      RAISE NOTICE 'Dropped FK constraint % on %.snapshot_run_id', constraint_name, tbl;
    ELSE
      RAISE NOTICE 'No existing FK constraint found on %.snapshot_run_id — adding fresh', tbl;
    END IF;

    -- Add FK with ON DELETE SET NULL
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (snapshot_run_id) REFERENCES smart_import_runs(id) ON DELETE SET NULL',
      tbl, tbl || '_snapshot_run_id_fkey'
    );
    RAISE NOTICE 'Added FK %_snapshot_run_id_fkey with ON DELETE SET NULL', tbl;
  END LOOP;
END $$;


-- ─── Step 3: Verification ──────────────────────────────────────────────────

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'program_expense', 'program_inflows', 'cashflow_points',
    'finance_revenue_monthly', 'finance_cos_monthly',
    'project_revenue_summary', 'normalized_cost_lines', 'normalized_revenue_lines'
  ];
  tbl TEXT;
  orphan_cnt INT;
  fk_exists BOOLEAN;
BEGIN
  RAISE NOTICE '=== SNAPSHOT_RUN_ID FK VERIFICATION ===';

  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I t WHERE t.snapshot_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM smart_import_runs s WHERE s.id = t.snapshot_run_id)',
      tbl
    ) INTO orphan_cnt;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = tbl
        AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.column_name = 'snapshot_run_id'
    ) INTO fk_exists;

    RAISE NOTICE '  %: orphans=%, fk_exists=%', tbl, orphan_cnt, fk_exists;
  END LOOP;

  RAISE NOTICE '=== END VERIFICATION ===';
END $$;
