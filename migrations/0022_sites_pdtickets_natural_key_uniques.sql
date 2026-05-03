-- 0022_sites_pdtickets_natural_key_uniques.sql
--
-- Task #40: extend the duplicate-prevention safety net introduced for
-- `clients` in 0018_clients_unique_pipedrive_org.sql to two more
-- Pipedrive-adjacent tables that today only enforce their natural keys
-- in application code:
--
--   * `sites` — the backfill at
--     `server/departments/data-backfill-routes.ts` and the manual
--     `POST /api/sites` route both rely on `(client_id, site_name)`
--     being unique per client. There is no DB-level guarantee, so a
--     parallel POST or a future PD-driven site sync could create silent
--     duplicates that then fan out to opportunities, projects,
--     site activities, snags, site inspections, and HSE incidents.
--
--   * `pd_tickets` — `0019_foundation_linkage_hardening.sql` and
--     `0020_pd_tickets_shadow_unique_softdelete_aware.sql` already
--     guarantee one *shadow* ticket per opportunity (project_id IS NULL,
--     deleted_at IS NULL). They do NOT guarantee uniqueness for
--     project-bound tickets, so the application-only `countSamePhaseTickets`
--     check in `server/repositories/opportunities-repository.ts` is the
--     last line of defence against two tickets for the same
--     (opportunity, project, request_type) — exactly the same risk class
--     `clients_pipedrive_org_id_uniq` closed for `clients`.
--
-- Both indexes are PARTIAL because the columns are legitimately NULL on
-- many real rows (app-owned sites without a client, internal R&D tickets
-- without an opportunity or project, shadow tickets without a project,
-- soft-deleted rows). A regular UNIQUE would reject those and break
-- production.
--
-- Defensive: pre-existing duplicates would block the index creation, so
-- we first drop the *safe* extras (rows that have never been linked to
-- any downstream table) and surface the rest via NOTICE for manual
-- resolution. If anything remains, the CREATE UNIQUE INDEX fails loudly
-- and aborts the migration — the desired behaviour, mirroring 0018.

BEGIN;

-- =============================================================
-- Part A: sites — natural key (client_id, site_name)
-- =============================================================

-- Step A1: drop safe duplicates. Within each (client_id, site_name)
-- group of live rows we keep the lowest id and try to delete every other
-- row that is NOT referenced by any downstream table.
WITH dupe_groups AS (
  SELECT client_id, site_name, MIN(id) AS keep_id, COUNT(*) AS n
  FROM sites
  WHERE deleted_at IS NULL
    AND client_id IS NOT NULL
    AND site_name IS NOT NULL
  GROUP BY client_id, site_name
  HAVING COUNT(*) > 1
),
extras AS (
  SELECT s.id, s.client_id, s.site_name
  FROM sites s
  JOIN dupe_groups d
    ON d.client_id = s.client_id
   AND d.site_name = s.site_name
  WHERE s.deleted_at IS NULL
    AND s.id <> d.keep_id
),
safe_to_drop AS (
  SELECT e.id
  FROM extras e
  WHERE NOT EXISTS (SELECT 1 FROM opportunities    o WHERE o.site_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM project_info     p WHERE p.site_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM site_activities  a WHERE a.site_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM snags            n WHERE n.site_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM site_inspections i WHERE i.site_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM hse_incidents    h WHERE h.site_id = e.id)
)
UPDATE sites
   SET deleted_at = NOW(),
       updated_at = NOW()
 WHERE id IN (SELECT id FROM safe_to_drop);

-- Step A2: surface anything we could NOT auto-resolve. The CREATE UNIQUE
-- INDEX below will then raise unique_violation and abort the migration.
DO $do$
DECLARE
  unresolved RECORD;
  unresolved_count INT := 0;
BEGIN
  FOR unresolved IN
    WITH dupe_groups AS (
      SELECT client_id, site_name, MIN(id) AS keep_id
      FROM sites
      WHERE deleted_at IS NULL
        AND client_id IS NOT NULL
        AND site_name IS NOT NULL
      GROUP BY client_id, site_name
      HAVING COUNT(*) > 1
    )
    SELECT s.id, s.client_id, s.site_name
    FROM sites s
    JOIN dupe_groups d
      ON d.client_id = s.client_id
     AND d.site_name = s.site_name
    WHERE s.deleted_at IS NULL
      AND s.id <> d.keep_id
    ORDER BY s.client_id, s.site_name, s.id
  LOOP
    unresolved_count := unresolved_count + 1;
    RAISE NOTICE '[0022_sites_pdtickets_natural_key_uniques] manual-resolution required: site id=% client_id=% site_name=%',
      unresolved.id, unresolved.client_id, unresolved.site_name;
  END LOOP;

  IF unresolved_count > 0 THEN
    RAISE NOTICE '[0022_sites_pdtickets_natural_key_uniques] % duplicate site row(s) have downstream links and were left in place; the unique index will fail until they are merged manually.',
      unresolved_count;
  END IF;
END
$do$;

-- Step A3: create the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS sites_client_site_name_uniq
  ON sites (client_id, site_name)
  WHERE deleted_at IS NULL
    AND client_id IS NOT NULL
    AND site_name IS NOT NULL;

-- =============================================================
-- Part B: pd_tickets — natural key (opportunity_id, project_id, request_type)
-- =============================================================
--
-- Complements `pd_tickets_opportunity_shadow_unique` (shadow tickets,
-- project_id IS NULL) by enforcing one ticket per phase for *project-bound*
-- tickets. Together they cover both ticket flavours. The migration leaves
-- internal/R&D tickets (opportunity_id IS NULL OR project_id IS NULL but
-- not the shadow case) free to duplicate, since no natural-key contract
-- exists for them.

-- Step B1: drop safe duplicates. We only auto-drop rows that have no
-- linked work_items — anything with downstream tasks must be merged by a
-- human.
WITH dupe_groups AS (
  SELECT opportunity_id, project_id, request_type,
         MIN(id) AS keep_id, COUNT(*) AS n
  FROM pd_tickets
  WHERE deleted_at IS NULL
    AND opportunity_id IS NOT NULL
    AND project_id IS NOT NULL
    AND request_type IS NOT NULL
  GROUP BY opportunity_id, project_id, request_type
  HAVING COUNT(*) > 1
),
extras AS (
  SELECT t.id, t.opportunity_id, t.project_id, t.request_type
  FROM pd_tickets t
  JOIN dupe_groups d
    ON d.opportunity_id = t.opportunity_id
   AND d.project_id     = t.project_id
   AND d.request_type   = t.request_type
  WHERE t.deleted_at IS NULL
    AND t.id <> d.keep_id
),
safe_to_drop AS (
  SELECT e.id
  FROM extras e
  WHERE NOT EXISTS (SELECT 1 FROM work_items w WHERE w.pd_ticket_id = e.id)
)
UPDATE pd_tickets
   SET deleted_at = NOW(),
       updated_at = NOW()
 WHERE id IN (SELECT id FROM safe_to_drop);

-- Step B2: surface anything we could NOT auto-resolve.
DO $do$
DECLARE
  unresolved RECORD;
  unresolved_count INT := 0;
BEGIN
  FOR unresolved IN
    WITH dupe_groups AS (
      SELECT opportunity_id, project_id, request_type, MIN(id) AS keep_id
      FROM pd_tickets
      WHERE deleted_at IS NULL
        AND opportunity_id IS NOT NULL
        AND project_id IS NOT NULL
        AND request_type IS NOT NULL
      GROUP BY opportunity_id, project_id, request_type
      HAVING COUNT(*) > 1
    )
    SELECT t.id, t.opportunity_id, t.project_id, t.request_type
    FROM pd_tickets t
    JOIN dupe_groups d
      ON d.opportunity_id = t.opportunity_id
     AND d.project_id     = t.project_id
     AND d.request_type   = t.request_type
    WHERE t.deleted_at IS NULL
      AND t.id <> d.keep_id
    ORDER BY t.opportunity_id, t.project_id, t.request_type, t.id
  LOOP
    unresolved_count := unresolved_count + 1;
    RAISE NOTICE '[0022_sites_pdtickets_natural_key_uniques] manual-resolution required: pd_ticket id=% opportunity_id=% project_id=% request_type=%',
      unresolved.id, unresolved.opportunity_id, unresolved.project_id, unresolved.request_type;
  END LOOP;

  IF unresolved_count > 0 THEN
    RAISE NOTICE '[0022_sites_pdtickets_natural_key_uniques] % duplicate pd_ticket row(s) have downstream work_items and were left in place; the unique index will fail until they are merged manually.',
      unresolved_count;
  END IF;
END
$do$;

-- Step B3: create the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS pd_tickets_phase_per_project_uniq
  ON pd_tickets (opportunity_id, project_id, request_type)
  WHERE deleted_at IS NULL
    AND opportunity_id IS NOT NULL
    AND project_id IS NOT NULL
    AND request_type IS NOT NULL;

COMMIT;
