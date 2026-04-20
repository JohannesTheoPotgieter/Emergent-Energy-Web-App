-- ============================================================
-- 20260420_opportunity_merge_pipedrive_enrich.sql
-- Enrich `opportunities` with the Pipedrive fields we currently
-- discard, so the merged "Opportunity" record can be the single
-- user-facing concept (PD Ticket disappears from UI).
--
-- All operations are additive and idempotent (IF NOT EXISTS).
-- No table drops, no column type changes, no PK changes.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Real column for the Pipedrive deal title.
--    Today the title is jammed into `notes` as "Pipedrive: <title>"
--    only on insert, then never updated. The list view greps it
--    out of notes. Promote it to a proper column.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deal_name TEXT;

-- ------------------------------------------------------------
-- 2. Pipedrive owner — `deal_owner_user_id` already exists but
--    sync never wrote it. Add a name snapshot for cases where
--    the Pipedrive owner email doesn't match a local user.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deal_owner_name TEXT;

-- ------------------------------------------------------------
-- 3. Currency, Pipedrive timestamps, stage-change time.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ZAR';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pipedrive_updated_at TIMESTAMP;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pipedrive_stage_changed_at TIMESTAMP;

-- ------------------------------------------------------------
-- 4. Sales intelligence — probability, weighted value, lost reason.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS weighted_value NUMERIC(15,2);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS lost_time TIMESTAMP;

-- ------------------------------------------------------------
-- 5. Primary contact (Pipedrive Person summary, denormalised).
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS person_email TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS person_phone TEXT;

-- ------------------------------------------------------------
-- 6. Activity signals — surfaces "neglected deal" alerts without
--    a full activity sync.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS activities_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_activity_date DATE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS next_activity_date DATE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS next_activity_subject TEXT;

-- ------------------------------------------------------------
-- 7. Pipedrive labels (free-form tags). Stored as comma-separated
--    text for now; can be promoted to a proper junction table later.
-- ------------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS labels TEXT;

-- ------------------------------------------------------------
-- 8. Backfill `deal_name` from the existing notes substring so
--    existing rows get a real title without waiting for next sync.
--    Match shape: 'Pipedrive: <title>' (sync writes this on insert).
-- ------------------------------------------------------------
UPDATE opportunities
   SET deal_name = TRIM(SUBSTRING(notes FROM '^Pipedrive:\s*(.*)$'))
 WHERE deal_name IS NULL
   AND notes ~ '^Pipedrive:\s*';

COMMIT;
