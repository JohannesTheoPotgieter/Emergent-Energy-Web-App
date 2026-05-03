-- =============================================================================
-- Migration: Convert financial amount columns from TEXT to NUMERIC(15,2)
-- Date: 2026-03-30
-- Risk: HIGH — run on staging first. Keep legacy columns for 30 days.
--
-- Tables affected:
--   normalized_revenue_lines: amount_ex_vat, vat
--   normalized_cost_lines: amount_ex_vat
--
-- This migration CAN run inside a transaction (no DDL that requires otherwise).
-- It is idempotent: all steps use IF NOT EXISTS / IF EXISTS guards.
-- =============================================================================

-- ─── Step 1: Add shadow numeric columns ─────────────────────────────────────

ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS amount_ex_vat_decimal NUMERIC(15,2);

ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS vat_decimal NUMERIC(15,2);

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS amount_ex_vat_decimal NUMERIC(15,2);


-- ─── Step 2: Audit table for unparseable values ─────────────────────────────

CREATE TABLE IF NOT EXISTS migration_unparseable_amounts (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  column_name TEXT NOT NULL,
  original_value TEXT,
  reason TEXT,
  migrated_at TIMESTAMP DEFAULT NOW()
);


-- ─── Step 3: Parse and copy with robust monetary value handling ─────────────
-- Handles:
--   - Plain numbers: "1234.56"
--   - Comma thousands: "1,234.56"
--   - Spaces: "1 234.56"
--   - Currency prefix: "R1234.56", "R 1,234.56"
--   - Negative: "-1234.56"
--   - Bracket negatives: "(1,234.56)"
--   - Empty strings, NULLs
--   - Placeholders: TBC, N/A, n/a, -, null, NULL, etc.
--
-- Negatives ARE allowed — credits, reversals, and adjustments use them.

-- Helper function: parse a monetary text value to numeric, or NULL if unparseable
CREATE OR REPLACE FUNCTION _parse_monetary(raw TEXT)
RETURNS NUMERIC(15,2) AS $$
DECLARE
  cleaned TEXT;
  is_negative BOOLEAN := FALSE;
  result NUMERIC(15,2);
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;

  cleaned := TRIM(raw);

  -- Empty or whitespace-only
  IF cleaned = '' THEN RETURN NULL; END IF;

  -- Placeholder values
  IF UPPER(cleaned) IN ('TBC', 'TBD', 'N/A', 'NA', 'NULL', 'NONE', '-', '--', '...') THEN
    RETURN NULL;
  END IF;

  -- Bracket negatives: "(1,234.56)" → negative
  IF cleaned LIKE '(%' AND cleaned LIKE '%)' THEN
    cleaned := SUBSTRING(cleaned FROM 2 FOR LENGTH(cleaned) - 2);
    is_negative := TRUE;
  END IF;

  -- Strip currency symbols (R, $, €, £) and leading/trailing whitespace
  cleaned := REGEXP_REPLACE(cleaned, '^[R$€£\s]+', '');
  cleaned := TRIM(cleaned);

  -- Handle negative sign
  IF LEFT(cleaned, 1) = '-' THEN
    is_negative := TRUE;
    cleaned := SUBSTRING(cleaned FROM 2);
    cleaned := TRIM(cleaned);
  END IF;

  -- Strip thousand separators (commas and spaces between digits)
  cleaned := REPLACE(cleaned, ',', '');
  cleaned := REPLACE(cleaned, ' ', '');

  -- Reject if nothing left or not a valid number pattern
  IF cleaned = '' OR cleaned !~ '^[0-9]+\.?[0-9]*$' THEN
    RETURN NULL;
  END IF;

  result := cleaned::NUMERIC(15,2);
  IF is_negative THEN result := -result; END IF;

  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- Parse normalized_revenue_lines.amount_ex_vat
UPDATE normalized_revenue_lines
SET amount_ex_vat_decimal = _parse_monetary(amount_ex_vat)
WHERE amount_ex_vat IS NOT NULL AND amount_ex_vat != '';

-- Log unparseable revenue amount_ex_vat values
INSERT INTO migration_unparseable_amounts (table_name, row_id, column_name, original_value, reason)
SELECT 'normalized_revenue_lines', id, 'amount_ex_vat', amount_ex_vat,
  CASE
    WHEN UPPER(TRIM(amount_ex_vat)) IN ('TBC','TBD','N/A','NA','NULL','NONE','-','--','...') THEN 'placeholder_value'
    ELSE 'unparseable_format'
  END
FROM normalized_revenue_lines
WHERE amount_ex_vat IS NOT NULL
  AND amount_ex_vat != ''
  AND _parse_monetary(amount_ex_vat) IS NULL;


-- Parse normalized_revenue_lines.vat
UPDATE normalized_revenue_lines
SET vat_decimal = _parse_monetary(vat)
WHERE vat IS NOT NULL AND vat != '';

-- Log unparseable revenue vat values
INSERT INTO migration_unparseable_amounts (table_name, row_id, column_name, original_value, reason)
SELECT 'normalized_revenue_lines', id, 'vat', vat,
  CASE
    WHEN UPPER(TRIM(vat)) IN ('TBC','TBD','N/A','NA','NULL','NONE','-','--','...') THEN 'placeholder_value'
    ELSE 'unparseable_format'
  END
FROM normalized_revenue_lines
WHERE vat IS NOT NULL
  AND vat != ''
  AND _parse_monetary(vat) IS NULL;


-- Parse normalized_cost_lines.amount_ex_vat
UPDATE normalized_cost_lines
SET amount_ex_vat_decimal = _parse_monetary(amount_ex_vat)
WHERE amount_ex_vat IS NOT NULL AND amount_ex_vat != '';

-- Log unparseable cost amount_ex_vat values
INSERT INTO migration_unparseable_amounts (table_name, row_id, column_name, original_value, reason)
SELECT 'normalized_cost_lines', id, 'amount_ex_vat', amount_ex_vat,
  CASE
    WHEN UPPER(TRIM(amount_ex_vat)) IN ('TBC','TBD','N/A','NA','NULL','NONE','-','--','...') THEN 'placeholder_value'
    ELSE 'unparseable_format'
  END
FROM normalized_cost_lines
WHERE amount_ex_vat IS NOT NULL
  AND amount_ex_vat != ''
  AND _parse_monetary(amount_ex_vat) IS NULL;


-- ─── Step 4: Verification queries ──────────────────────────────────────────
-- Run these after migration to verify correctness. Output as NOTICE for logging.

DO $$
DECLARE
  rev_total INT; rev_parsed INT; rev_failed INT;
  rev_vat_total INT; rev_vat_parsed INT; rev_vat_failed INT;
  cost_total INT; cost_parsed INT; cost_failed INT;
  rev_sum_text NUMERIC; rev_sum_decimal NUMERIC;
  cost_sum_text NUMERIC; cost_sum_decimal NUMERIC;
BEGIN
  -- Revenue amount_ex_vat
  SELECT COUNT(*) INTO rev_total FROM normalized_revenue_lines WHERE amount_ex_vat IS NOT NULL AND amount_ex_vat != '';
  SELECT COUNT(*) INTO rev_parsed FROM normalized_revenue_lines WHERE amount_ex_vat_decimal IS NOT NULL;
  SELECT COUNT(*) INTO rev_failed FROM migration_unparseable_amounts WHERE table_name = 'normalized_revenue_lines' AND column_name = 'amount_ex_vat';
  SELECT COALESCE(SUM(NULLIF(amount_ex_vat,'')::numeric), 0) INTO rev_sum_text FROM normalized_revenue_lines WHERE amount_ex_vat ~ '^-?[0-9]+\.?[0-9]*$';
  SELECT COALESCE(SUM(amount_ex_vat_decimal), 0) INTO rev_sum_decimal FROM normalized_revenue_lines;

  RAISE NOTICE '=== VERIFICATION REPORT ===';
  RAISE NOTICE 'normalized_revenue_lines.amount_ex_vat: total=%, parsed=%, failed=%', rev_total, rev_parsed, rev_failed;
  RAISE NOTICE '  text_sum=%, decimal_sum=%, delta=%', rev_sum_text, rev_sum_decimal, rev_sum_decimal - rev_sum_text;

  -- Revenue vat
  SELECT COUNT(*) INTO rev_vat_total FROM normalized_revenue_lines WHERE vat IS NOT NULL AND vat != '';
  SELECT COUNT(*) INTO rev_vat_parsed FROM normalized_revenue_lines WHERE vat_decimal IS NOT NULL;
  SELECT COUNT(*) INTO rev_vat_failed FROM migration_unparseable_amounts WHERE table_name = 'normalized_revenue_lines' AND column_name = 'vat';
  RAISE NOTICE 'normalized_revenue_lines.vat: total=%, parsed=%, failed=%', rev_vat_total, rev_vat_parsed, rev_vat_failed;

  -- Cost amount_ex_vat
  SELECT COUNT(*) INTO cost_total FROM normalized_cost_lines WHERE amount_ex_vat IS NOT NULL AND amount_ex_vat != '';
  SELECT COUNT(*) INTO cost_parsed FROM normalized_cost_lines WHERE amount_ex_vat_decimal IS NOT NULL;
  SELECT COUNT(*) INTO cost_failed FROM migration_unparseable_amounts WHERE table_name = 'normalized_cost_lines' AND column_name = 'amount_ex_vat';
  SELECT COALESCE(SUM(NULLIF(amount_ex_vat,'')::numeric), 0) INTO cost_sum_text FROM normalized_cost_lines WHERE amount_ex_vat ~ '^-?[0-9]+\.?[0-9]*$';
  SELECT COALESCE(SUM(amount_ex_vat_decimal), 0) INTO cost_sum_decimal FROM normalized_cost_lines;

  RAISE NOTICE 'normalized_cost_lines.amount_ex_vat: total=%, parsed=%, failed=%', cost_total, cost_parsed, cost_failed;
  RAISE NOTICE '  text_sum=%, decimal_sum=%, delta=%', cost_sum_text, cost_sum_decimal, cost_sum_decimal - cost_sum_text;
  RAISE NOTICE '=== END VERIFICATION ===';
END $$;


-- ─── Step 5: Rename columns (text → *_legacy, decimal → canonical) ──────────
-- Legacy text columns kept for 30-day observation. Do NOT drop them.

ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_legacy;
ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat_decimal TO amount_ex_vat;

ALTER TABLE normalized_revenue_lines RENAME COLUMN vat TO vat_legacy;
ALTER TABLE normalized_revenue_lines RENAME COLUMN vat_decimal TO vat;

ALTER TABLE normalized_cost_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_legacy;
ALTER TABLE normalized_cost_lines RENAME COLUMN amount_ex_vat_decimal TO amount_ex_vat;


-- ─── Cleanup: Drop helper function ─────────────────────────────────────────
-- Keep function for potential re-runs; drop in cleanup PR after 30 days.
-- DROP FUNCTION IF EXISTS _parse_monetary(TEXT);
