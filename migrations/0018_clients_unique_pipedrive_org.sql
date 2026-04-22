-- 0018_clients_unique_pipedrive_org.sql
--
-- Defence-in-depth: prevent duplicate `clients` rows for the same Pipedrive
-- organisation. The Pipedrive sync (`resolveClientId` in
-- `server/services/pipedrive-sync-service.ts`) already runs inside an
-- advisory-locked transaction so concurrent syncs cannot race, but the
-- table itself only has a UNIQUE constraint on `client_id`. A partial
-- UNIQUE index on `pipedrive_org_id` (where not null) makes it impossible
-- for any future code path — a manual SQL insert, a migration script, a
-- forgotten admin endpoint — to create two client rows for the same
-- Pipedrive org.
--
-- The index is partial because most app-owned (non-Pipedrive) clients
-- legitimately have NULL `pipedrive_org_id` and a regular UNIQUE would
-- only allow one such row.
--
-- Defensive: if any pre-existing duplicates exist they would block the
-- index creation, so we first drop the *safe* extras (rows that have
-- never been linked to an opportunity, project, PD ticket, or project
-- client history). Duplicates that ARE linked downstream are left alone
-- and reported via NOTICE so an operator can resolve them manually; in
-- that case the CREATE will raise and the migration fails loudly, which
-- is the desired behaviour.

BEGIN;

-- Step 1: dedupe safe duplicates. Within each duplicate group on
-- pipedrive_org_id we keep the lowest id and try to delete every other
-- row that is NOT referenced by any downstream table.
WITH dupe_groups AS (
  SELECT pipedrive_org_id, MIN(id) AS keep_id, COUNT(*) AS n
  FROM clients
  WHERE pipedrive_org_id IS NOT NULL
  GROUP BY pipedrive_org_id
  HAVING COUNT(*) > 1
),
extras AS (
  SELECT c.id, c.pipedrive_org_id
  FROM clients c
  JOIN dupe_groups d ON d.pipedrive_org_id = c.pipedrive_org_id
  WHERE c.id <> d.keep_id
),
safe_to_drop AS (
  SELECT e.id, e.pipedrive_org_id
  FROM extras e
  WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.client_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM project_info p WHERE p.client_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM pd_tickets t WHERE t.client_id = e.id)
    AND NOT EXISTS (
      SELECT 1 FROM project_client_history h
      WHERE h.new_client_id = e.id OR h.old_client_id = e.id
    )
    AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.client_id = e.id)
)
DELETE FROM clients WHERE id IN (SELECT id FROM safe_to_drop);

-- Step 2: surface any duplicates that we could NOT auto-resolve so the
-- operator running the migration sees them in the migration log. The
-- CREATE UNIQUE INDEX below will then raise a unique_violation and abort
-- the migration, which is the desired behaviour: a human must merge
-- those clients manually before this index can come online.
DO $do$
DECLARE
  unresolved RECORD;
  unresolved_count INT := 0;
BEGIN
  FOR unresolved IN
    WITH dupe_groups AS (
      SELECT pipedrive_org_id, MIN(id) AS keep_id
      FROM clients
      WHERE pipedrive_org_id IS NOT NULL
      GROUP BY pipedrive_org_id
      HAVING COUNT(*) > 1
    )
    SELECT c.id, c.client_id, c.name, c.pipedrive_org_id
    FROM clients c
    JOIN dupe_groups d ON d.pipedrive_org_id = c.pipedrive_org_id
    WHERE c.id <> d.keep_id
    ORDER BY c.pipedrive_org_id, c.id
  LOOP
    unresolved_count := unresolved_count + 1;
    RAISE NOTICE '[0018_clients_unique_pipedrive_org] manual-resolution required: client id=% client_id=% name=% pipedrive_org_id=%',
      unresolved.id, unresolved.client_id, unresolved.name, unresolved.pipedrive_org_id;
  END LOOP;

  IF unresolved_count > 0 THEN
    RAISE NOTICE '[0018_clients_unique_pipedrive_org] % duplicate client row(s) have downstream links and were left in place; the unique index will fail until they are merged manually.',
      unresolved_count;
  END IF;
END
$do$;

-- Step 3: create the partial unique index. IF NOT EXISTS makes this
-- idempotent on re-run.
CREATE UNIQUE INDEX IF NOT EXISTS clients_pipedrive_org_id_uniq
  ON clients (pipedrive_org_id)
  WHERE pipedrive_org_id IS NOT NULL;

COMMIT;
