-- QuickBooks link hardening: enforce one-to-one links.
--
-- The `quickbooks_invoice_links` table already has a unique index on the
-- full 5-tuple (app_entity_type, app_entity_id, qb_entity_type,
-- qb_entity_id, qb_realm_id). That prevents *exact* duplicates but still
-- allows:
--
--   - the same app cost/revenue line being linked to TWO different QB
--     docs at the same time; and
--   - the same QB bill/invoice being linked to TWO different app lines
--     at the same time.
--
-- Neither is correct for a reconciliation boundary: QuickBooks is the
-- evidence, the app is the operational truth, and the link is supposed
-- to be a 1:1 attestation. This migration installs two partial unique
-- indexes (WHERE deleted_at IS NULL) to enforce that invariant at the
-- database level, with soft-delete awareness so a previously unlinked
-- pair can be re-linked later.
--
-- The migration is defensive: it de-duplicates any existing offending
-- rows BEFORE creating the indexes. For each (app_entity_type,
-- app_entity_id, qb_realm_id) group with multiple active rows, we keep
-- the most-recently confirmed row and soft-delete the rest. Ditto for
-- (qb_entity_type, qb_entity_id, qb_realm_id).
--
-- Rollback: 20260415_quickbooks_link_one_to_one_rollback.sql
--
-- NOTE: this migration only enforces uniqueness. It does not delete any
-- data beyond soft-deleting the duplicates it needed to remove to make
-- the indexes valid. No hard deletes anywhere.

BEGIN;

-- Safety: this migration is a no-op if the table does not yet exist
-- (e.g. a fresh dev environment where Drizzle push has not run). In
-- that case the Drizzle schema definition already carries the indexes,
-- so we don't need to do anything.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'quickbooks_invoice_links'
  ) THEN
    RAISE NOTICE 'quickbooks_invoice_links not present; skipping (Drizzle schema carries the indexes)';
    RETURN;
  END IF;

  -- Step 1. Soft-delete duplicates on the (app_entity_type, app_entity_id,
  -- qb_realm_id) axis. Keep the most recently confirmed row per group.
  WITH ranked AS (
    SELECT id,
           app_entity_type,
           app_entity_id,
           qb_realm_id,
           ROW_NUMBER() OVER (
             PARTITION BY app_entity_type, app_entity_id, qb_realm_id
             ORDER BY confirmed_at DESC NULLS LAST, id DESC
           ) AS rn
      FROM quickbooks_invoice_links
     WHERE deleted_at IS NULL
  )
  UPDATE quickbooks_invoice_links q
     SET deleted_at = now(),
         updated_at = now(),
         notes      = COALESCE(q.notes, '')
                       || ' [auto-superseded by 20260415_quickbooks_link_one_to_one]'
    FROM ranked r
   WHERE q.id = r.id
     AND r.rn > 1;

  -- Step 2. Same thing on the QB side:
  -- (qb_entity_type, qb_entity_id, qb_realm_id).
  WITH ranked AS (
    SELECT id,
           qb_entity_type,
           qb_entity_id,
           qb_realm_id,
           ROW_NUMBER() OVER (
             PARTITION BY qb_entity_type, qb_entity_id, qb_realm_id
             ORDER BY confirmed_at DESC NULLS LAST, id DESC
           ) AS rn
      FROM quickbooks_invoice_links
     WHERE deleted_at IS NULL
  )
  UPDATE quickbooks_invoice_links q
     SET deleted_at = now(),
         updated_at = now(),
         notes      = COALESCE(q.notes, '')
                       || ' [auto-superseded by 20260415_quickbooks_link_one_to_one]'
    FROM ranked r
   WHERE q.id = r.id
     AND r.rn > 1;
END $$;

-- Step 3. Install the partial unique indexes.

-- One app line may only be linked to a single QB doc per realm at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_links_app_entity_active
  ON quickbooks_invoice_links (app_entity_type, app_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;

-- One QB doc may only be linked to a single app line per realm at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_links_qb_entity_active
  ON quickbooks_invoice_links (qb_entity_type, qb_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX uq_qb_links_app_entity_active IS
  'Enforces 1:1 active link per (app line, realm). A new link write with a conflicting app line must unlink first or specify supersede.';
COMMENT ON INDEX uq_qb_links_qb_entity_active IS
  'Enforces 1:1 active link per (QB doc, realm). A new link write with a conflicting QB doc must unlink first or specify supersede.';

COMMIT;
