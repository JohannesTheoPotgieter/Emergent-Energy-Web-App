-- =============================================================================
-- Rollback: Revert snapshotRunId FK constraints to ON DELETE RESTRICT
-- Date: 2026-03-31
--
-- Restores original FK behavior (RESTRICT) from migration 20260333.
-- Quarantine audit table (snapshot_run_id_orphan_audit) is preserved.
-- =============================================================================

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
    -- Find and drop the SET NULL FK
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
    END IF;

    -- Re-add with ON DELETE RESTRICT (original behavior)
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (snapshot_run_id) REFERENCES smart_import_runs(id)',
      tbl, tbl || '_snapshot_run_id_fkey'
    );
  END LOOP;
END $$;

-- Note: snapshot_run_id_orphan_audit table is intentionally preserved.
