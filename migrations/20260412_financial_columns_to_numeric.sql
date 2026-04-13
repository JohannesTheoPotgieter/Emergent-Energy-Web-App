-- C4 (audit closeout): convert all monetary columns from float (real) to
-- exact numeric / decimal types so ZAR amounts cannot drift through float
-- rounding errors.
--
-- Affected columns and their canonical Drizzle definitions
-- (see shared/schema/*.ts for the matching code-side declarations):
--
--   change_requests.cost_impact          real -> numeric(15, 2)
--   invoice_captures.amount              real -> numeric(15, 2)
--   invoice_captures.vat_amount          real -> numeric(15, 2)
--   procurement_items.expected_cost      real -> numeric(15, 2)
--   procurement_items.actual_cost        real -> numeric(15, 2)
--   procurement_items.quantity           real -> numeric(15, 3)   (3 decimals
--                                                                  for quantity
--                                                                  units like
--                                                                  hours/kg)
--
-- All conversions use ROUND(value::numeric, scale) so existing rows are
-- preserved with the appropriate precision. Wrapped in a single transaction
-- so a failure rolls back the entire batch.
--
-- IDEMPOTENCE: re-running this migration on already-converted columns is a
-- no-op for the data. The ALTER TYPE statements would fail on the second
-- run because they assume the source type is `real`. To make the migration
-- safely re-runnable, each ALTER is guarded by a column-type check.

BEGIN;

-- change_requests.cost_impact
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'change_requests'
      AND column_name = 'cost_impact'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE change_requests
      ALTER COLUMN cost_impact TYPE numeric(15, 2)
      USING ROUND(cost_impact::numeric, 2);
  END IF;
END $$;

-- invoice_captures.amount
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_captures'
      AND column_name = 'amount'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE invoice_captures
      ALTER COLUMN amount TYPE numeric(15, 2)
      USING ROUND(amount::numeric, 2);
  END IF;
END $$;

-- invoice_captures.vat_amount
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_captures'
      AND column_name = 'vat_amount'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE invoice_captures
      ALTER COLUMN vat_amount TYPE numeric(15, 2)
      USING ROUND(vat_amount::numeric, 2);
  END IF;
END $$;

-- procurement_items.expected_cost
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'expected_cost'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN expected_cost TYPE numeric(15, 2)
      USING ROUND(expected_cost::numeric, 2);
  END IF;
END $$;

-- procurement_items.actual_cost
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'actual_cost'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN actual_cost TYPE numeric(15, 2)
      USING ROUND(actual_cost::numeric, 2);
  END IF;
END $$;

-- procurement_items.quantity
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_items'
      AND column_name = 'quantity'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE procurement_items
      ALTER COLUMN quantity TYPE numeric(15, 3)
      USING ROUND(quantity::numeric, 3);
  END IF;
END $$;

-- Verification: every column above should now have numeric type
SELECT
  table_name,
  column_name,
  data_type,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'change_requests'   AND column_name = 'cost_impact')
    OR (table_name = 'invoice_captures' AND column_name IN ('amount', 'vat_amount'))
    OR (table_name = 'procurement_items' AND column_name IN ('expected_cost', 'actual_cost', 'quantity'))
  )
ORDER BY table_name, column_name;

COMMIT;
