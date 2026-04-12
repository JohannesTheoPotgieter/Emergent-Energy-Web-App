-- ROLLBACK for 20260412_financial_columns_to_numeric.sql
--
-- Reverts the affected columns from numeric back to real (float).
-- WARNING: this is a LOSSY conversion — values that exceed float32 precision
-- (~7 significant digits) will be rounded. For ZAR amounts under 100 million
-- this should be safe, but it is not bit-exact.
--
-- Each rollback is guarded so re-running is a no-op once the rollback has
-- already been applied.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'change_requests'
      AND column_name = 'cost_impact'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE change_requests
      ALTER COLUMN cost_impact TYPE real USING cost_impact::real;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_captures'
      AND column_name = 'amount'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE invoice_captures
      ALTER COLUMN amount TYPE real USING amount::real;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_captures'
      AND column_name = 'vat_amount'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE invoice_captures
      ALTER COLUMN vat_amount TYPE real USING vat_amount::real;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'expected_cost'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN expected_cost TYPE real USING expected_cost::real;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'actual_cost'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN actual_cost TYPE real USING actual_cost::real;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'quantity'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN quantity TYPE real USING quantity::real;
  END IF;
END $$;

COMMIT;
