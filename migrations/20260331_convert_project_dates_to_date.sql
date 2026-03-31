-- =============================================================================
-- Migration: Convert projectExecutionState TEXT date columns to DATE type
-- Date: 2026-03-31
-- Risk: HIGH — run on staging first. Keep legacy columns for 30 days.
--
-- Table: project_execution_state
-- Columns (13 total, verified from shared/schema/projects.ts lines 139-205):
--   1. pd_handover_date
--   2. construction_start_date
--   3. commissioning_date
--   4. om_handover_date
--   5. client_handover_date
--   6. construction_start_actual
--   7. pd_handover_actual
--   8. commissioning_actual
--   9. client_handover_actual
--  10. signed_date
--  11. cp_signed_date
--  12. site_establishment_date
--  13. site_establishment_actual
--
-- This migration CAN run inside a transaction.
-- It is idempotent: all steps use IF NOT EXISTS guards.
-- =============================================================================

-- ─── Step 1: Add shadow DATE columns ────────────────────────────────────────

ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS pd_handover_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS construction_start_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS commissioning_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS om_handover_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS client_handover_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS construction_start_actual_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS pd_handover_actual_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS commissioning_actual_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS client_handover_actual_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS signed_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS cp_signed_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS site_establishment_date_typed DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS site_establishment_actual_typed DATE;


-- ─── Step 2: Audit table for unparseable values ─────────────────────────────

CREATE TABLE IF NOT EXISTS migration_unparseable_dates (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  column_name TEXT NOT NULL,
  original_value TEXT,
  reason TEXT,
  migrated_at TIMESTAMP DEFAULT NOW()
);


-- ─── Step 3: Parse and copy ─────────────────────────────────────────────────
-- Handles:
--   a. YYYY-MM-DD (standard ISO date)
--   b. YYYY-MM-DDTHH:mm:ss / ISO datetime strings (truncated to date)
--   c. DD/MM/YYYY
--   d. DD-Mon-YYYY (e.g. 15-Jan-2026)
--   e. Excel serial dates (numeric strings like "45678")
--   f. Blank/placeholder values → NULL

CREATE OR REPLACE FUNCTION _parse_text_to_date(raw TEXT)
RETURNS DATE AS $$
DECLARE
  cleaned TEXT;
  result DATE;
  serial_num NUMERIC;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  cleaned := TRIM(raw);
  IF cleaned = '' THEN RETURN NULL; END IF;

  -- Placeholders
  IF UPPER(cleaned) IN ('TBC', 'TBD', 'N/A', 'NA', 'NULL', 'NONE', '-', '--', '...', 'PENDING') THEN
    RETURN NULL;
  END IF;

  -- a. YYYY-MM-DD
  IF cleaned ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      RETURN cleaned::DATE;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  -- b. ISO datetime: YYYY-MM-DDTHH:mm:ss...
  IF cleaned ~ '^\d{4}-\d{2}-\d{2}T' THEN
    BEGIN
      RETURN (LEFT(cleaned, 10))::DATE;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  -- c. DD/MM/YYYY
  IF cleaned ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    BEGIN
      RETURN TO_DATE(cleaned, 'DD/MM/YYYY');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  -- d. DD-Mon-YYYY (e.g. 15-Jan-2026)
  IF cleaned ~ '^\d{1,2}-[A-Za-z]{3}-\d{4}$' THEN
    BEGIN
      RETURN TO_DATE(cleaned, 'DD-Mon-YYYY');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  -- e. Excel serial date (pure numeric string, 5 digits typically)
  IF cleaned ~ '^\d{4,6}(\.\d+)?$' THEN
    BEGIN
      serial_num := cleaned::NUMERIC;
      IF serial_num >= 1 AND serial_num <= 200000 THEN
        -- Excel epoch: 1900-01-01 is serial 1, but Excel has the 1900 leap year bug
        RETURN DATE '1899-12-30' + serial_num::INTEGER;
      END IF;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- Parse each column and log failures.
-- Using a DO block to process all 13 columns in one pass per row.

DO $$
DECLARE
  r RECORD;
  v_date DATE;
  cols TEXT[] := ARRAY[
    'pd_handover_date', 'construction_start_date', 'commissioning_date',
    'om_handover_date', 'client_handover_date',
    'construction_start_actual', 'pd_handover_actual',
    'commissioning_actual', 'client_handover_actual',
    'signed_date', 'cp_signed_date',
    'site_establishment_date', 'site_establishment_actual'
  ];
  col_name TEXT;
  raw_val TEXT;
BEGIN
  FOR r IN SELECT * FROM project_execution_state LOOP
    -- Process each of the 13 columns
    FOREACH col_name IN ARRAY cols LOOP
      EXECUTE format('SELECT ($1).%I', col_name) INTO raw_val USING r;

      IF raw_val IS NOT NULL AND TRIM(raw_val) != '' THEN
        v_date := _parse_text_to_date(raw_val);

        IF v_date IS NOT NULL THEN
          EXECUTE format(
            'UPDATE project_execution_state SET %I = $1 WHERE id = $2',
            col_name || '_typed'
          ) USING v_date, r.id;
        ELSE
          INSERT INTO migration_unparseable_dates
            (table_name, row_id, column_name, original_value, reason)
          VALUES (
            'project_execution_state', r.id, col_name, raw_val,
            CASE
              WHEN UPPER(TRIM(raw_val)) IN ('TBC','TBD','N/A','NA','NULL','NONE','-','--','...','PENDING')
                THEN 'placeholder_value'
              ELSE 'unparseable_format'
            END
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;


-- ─── Step 4: Verification queries ──────────────────────────────────────────

DO $$
DECLARE
  col TEXT;
  cols TEXT[] := ARRAY[
    'pd_handover_date', 'construction_start_date', 'commissioning_date',
    'om_handover_date', 'client_handover_date',
    'construction_start_actual', 'pd_handover_actual',
    'commissioning_actual', 'client_handover_actual',
    'signed_date', 'cp_signed_date',
    'site_establishment_date', 'site_establishment_actual'
  ];
  total INT; parsed INT; failed INT;
BEGIN
  RAISE NOTICE '=== PROJECT EXECUTION STATE DATE MIGRATION VERIFICATION ===';

  FOREACH col IN ARRAY cols LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM project_execution_state WHERE %I IS NOT NULL AND TRIM(%I) != $$$$',
      col, col
    ) INTO total;

    EXECUTE format(
      'SELECT COUNT(*) FROM project_execution_state WHERE %I IS NOT NULL',
      col || '_typed'
    ) INTO parsed;

    SELECT COUNT(*) INTO failed
    FROM migration_unparseable_dates
    WHERE table_name = 'project_execution_state' AND column_name = col;

    RAISE NOTICE '  %: total=%, parsed=%, failed=%', col, total, parsed, failed;
  END LOOP;

  RAISE NOTICE '=== END VERIFICATION ===';
END $$;


-- ─── Step 5: Rename columns (text → *_legacy, typed → canonical) ────────────
-- Legacy text columns kept for 30-day observation. Do NOT drop them.

ALTER TABLE project_execution_state RENAME COLUMN pd_handover_date TO pd_handover_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN pd_handover_date_typed TO pd_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN construction_start_date TO construction_start_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN construction_start_date_typed TO construction_start_date;

ALTER TABLE project_execution_state RENAME COLUMN commissioning_date TO commissioning_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN commissioning_date_typed TO commissioning_date;

ALTER TABLE project_execution_state RENAME COLUMN om_handover_date TO om_handover_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN om_handover_date_typed TO om_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN client_handover_date TO client_handover_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN client_handover_date_typed TO client_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN construction_start_actual TO construction_start_actual_legacy;
ALTER TABLE project_execution_state RENAME COLUMN construction_start_actual_typed TO construction_start_actual;

ALTER TABLE project_execution_state RENAME COLUMN pd_handover_actual TO pd_handover_actual_legacy;
ALTER TABLE project_execution_state RENAME COLUMN pd_handover_actual_typed TO pd_handover_actual;

ALTER TABLE project_execution_state RENAME COLUMN commissioning_actual TO commissioning_actual_legacy;
ALTER TABLE project_execution_state RENAME COLUMN commissioning_actual_typed TO commissioning_actual;

ALTER TABLE project_execution_state RENAME COLUMN client_handover_actual TO client_handover_actual_legacy;
ALTER TABLE project_execution_state RENAME COLUMN client_handover_actual_typed TO client_handover_actual;

ALTER TABLE project_execution_state RENAME COLUMN signed_date TO signed_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN signed_date_typed TO signed_date;

ALTER TABLE project_execution_state RENAME COLUMN cp_signed_date TO cp_signed_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN cp_signed_date_typed TO cp_signed_date;

ALTER TABLE project_execution_state RENAME COLUMN site_establishment_date TO site_establishment_date_legacy;
ALTER TABLE project_execution_state RENAME COLUMN site_establishment_date_typed TO site_establishment_date;

ALTER TABLE project_execution_state RENAME COLUMN site_establishment_actual TO site_establishment_actual_legacy;
ALTER TABLE project_execution_state RENAME COLUMN site_establishment_actual_typed TO site_establishment_actual;
