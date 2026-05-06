-- 0032: Backfill engineering work_items from existing engineering_tickets so the
-- Engineering Task Board (work_items WHERE workstream='ENG') surfaces every
-- ticket that was created from the Opportunity drawer before commit
-- "engineering tickets auto-spawn work_items".
--
-- Additive, idempotent. Hand-authored. Companion to the application-side
-- change in server/departments/opportunities-routes.ts that, going forward,
-- inserts a sibling work_items row in the same transaction as each pd_ticket
-- (engineering_ticket).
--
-- Safe to run multiple times:
--   * Step 1 creates a partial unique index that prevents duplicate active
--     ENG work_items pointing at the same engineering_ticket — closing the
--     concurrency hole the architect flagged.
--   * Step 2 is a NOT EXISTS guarded INSERT.
--   * Date coercion is regex-guarded so a single malformed legacy due_date
--     cannot abort the whole statement.
--   * Critical pd_ticket priority is correctly mapped to Urgent on the
--     work_items side (which has no Critical lane).

-- Step 1: concurrency-safe linkage uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS work_items_active_eng_ticket_uniq
  ON work_items (engineering_ticket_id)
  WHERE workstream = 'ENG'
    AND deleted_at IS NULL
    AND engineering_ticket_id IS NOT NULL;

-- Step 2: idempotent backfill.
INSERT INTO work_items (
  client_id,
  project_id,
  workstream,
  source,
  type,
  title,
  description,
  status,
  priority,
  phase,
  end_date,
  owner_user_id,
  engineering_ticket_id,
  created_by,
  created_at,
  updated_at
)
SELECT
  et.client_id,
  et.project_id,
  'ENG'::work_item_workstream,
  'SYSTEM'::work_item_source,
  'task',
  et.project_site_name,
  et.comments,
  'to_do',
  CASE
    WHEN et.priority = 'Medium' THEN 'Med'
    WHEN et.priority = 'Critical' THEN 'Urgent'
    WHEN et.priority IN ('Low', 'Med', 'High', 'Urgent') THEN et.priority
    ELSE 'Med'
  END,
  et.request_type,
  CASE
    WHEN et.due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN et.due_date::date
    ELSE NULL
  END,
  NULL,
  et.id,
  COALESCE(et.created_by, (SELECT MIN(id) FROM users)),
  COALESCE(et.created_at, now()),
  now()
FROM engineering_tickets et
WHERE et.deleted_at IS NULL
  AND et.project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM work_items wi
    WHERE wi.engineering_ticket_id = et.id
      AND wi.workstream = 'ENG'
      AND wi.deleted_at IS NULL
  )
ON CONFLICT (engineering_ticket_id)
  WHERE workstream = 'ENG'
    AND deleted_at IS NULL
    AND engineering_ticket_id IS NOT NULL
  DO NOTHING;
