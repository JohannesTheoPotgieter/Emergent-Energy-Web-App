-- ============================================================
-- MIGRATION: Consolidate legacy client tables into canonical stage-collaboration tables
-- Date: 2026-03-31
-- Risk: MEDIUM
-- Transaction: YES — all operations run inside a single transaction
-- ============================================================
--
-- Legacy tables:
--   client_commitments     → project_client_commitments
--   client_updates         → project_client_updates
--
-- This migration:
--   1. Adds migrated_from_legacy column to canonical tables
--   2. Copies legacy rows with explicit field mapping
--   3. Uses explicit conflict targets (not bare ON CONFLICT DO NOTHING)
--   4. Records migrated row counts via RAISE NOTICE
-- ============================================================

BEGIN;

-- ── Step 1: Add migrated_from_legacy flag to canonical tables ──

ALTER TABLE project_client_commitments
  ADD COLUMN IF NOT EXISTS migrated_from_legacy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE project_client_updates
  ADD COLUMN IF NOT EXISTS migrated_from_legacy BOOLEAN NOT NULL DEFAULT false;

-- ── Step 2: Add temporary unique constraint for commitment dedup ──
-- project_client_commitments has no natural unique constraint beyond PK.
-- We add a temporary one on (project_id, commitment_text, committed_date)
-- to prevent duplicate migration runs.

-- First, create a helper index for the conflict target
CREATE UNIQUE INDEX IF NOT EXISTS pcc_legacy_dedup_idx
  ON project_client_commitments (project_id, commitment_text, committed_date);

-- ── Step 3: Migrate client_commitments → project_client_commitments ──

DO $$
DECLARE
  commitments_migrated INTEGER;
  updates_migrated INTEGER;
BEGIN
  -- Check if legacy tables exist before migrating
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_commitments') THEN

    WITH inserted AS (
      INSERT INTO project_client_commitments (
        project_id,
        stage_code_created,
        commitment_text,
        committed_by_user_id,
        committed_date,
        delivery_stage_code,
        status,
        delivered_date,
        notes,
        created_at,
        migrated_from_legacy
      )
      SELECT
        cc.project_id,
        cc.stage_code_created,
        cc.commitment_text,
        cc.committed_by_user_id,
        cc.committed_date,
        cc.delivery_stage_code,
        UPPER(cc.status),           -- normalize: open → OPEN, delivered → DELIVERED, etc.
        cc.delivered_date,
        cc.notes,
        cc.created_at,
        true                        -- mark as migrated from legacy
      FROM client_commitments cc
      ON CONFLICT (project_id, commitment_text, committed_date) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO commitments_migrated FROM inserted;

    RAISE NOTICE '[consolidate_client_tables] Migrated % rows from client_commitments → project_client_commitments', commitments_migrated;

  ELSE
    RAISE NOTICE '[consolidate_client_tables] Legacy table client_commitments does not exist — skipping';
    commitments_migrated := 0;
  END IF;

  -- ── Step 4: Migrate client_updates → project_client_updates ──

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_updates') THEN

    WITH inserted AS (
      INSERT INTO project_client_updates (
        project_id,
        update_number,
        due_date,
        status,
        progress_summary_text,
        completed_this_period_text,
        next_7_days_text,
        blockers_text,
        client_actions_required_text,
        attachment_urls,
        sent_by_user_id,
        reviewer_user_id,
        sent_date,
        created_at,
        updated_at,
        migrated_from_legacy
      )
      SELECT
        cu.project_id,
        cu.update_number,
        cu.next_client_update_due_date::date,   -- cast timestamp → date
        UPPER(cu.client_update_status),          -- normalize: draft → DRAFT, etc.
        cu.progress_summary_text,
        cu.completed_this_period_text,
        cu.next_7_days_text,
        cu.blockers_text,
        cu.client_actions_required_text,
        cu.attachment_urls,
        cu.client_update_sent_by,                -- rename: client_update_sent_by → sent_by_user_id
        cu.reviewer_user_id,
        cu.sent_date,
        cu.created_at,
        cu.created_at,                           -- updated_at defaults to created_at for legacy rows
        true                                     -- mark as migrated from legacy
      FROM client_updates cu
      ON CONFLICT ON CONSTRAINT pcu_project_update_uq DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO updates_migrated FROM inserted;

    RAISE NOTICE '[consolidate_client_tables] Migrated % rows from client_updates → project_client_updates', updates_migrated;

  ELSE
    RAISE NOTICE '[consolidate_client_tables] Legacy table client_updates does not exist — skipping';
    updates_migrated := 0;
  END IF;

  -- ── Step 5: Record migration metadata ──

  RAISE NOTICE '[consolidate_client_tables] Migration complete. Commitments: %, Updates: %', commitments_migrated, updates_migrated;

END $$;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================================
--
-- 1. Check migrated commitment counts:
--    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE migrated_from_legacy) AS from_legacy
--    FROM project_client_commitments;
--
-- 2. Check migrated update counts:
--    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE migrated_from_legacy) AS from_legacy
--    FROM project_client_updates;
--
-- 3. Verify no duplicates in commitments:
--    SELECT project_id, commitment_text, committed_date, COUNT(*)
--    FROM project_client_commitments
--    GROUP BY project_id, commitment_text, committed_date
--    HAVING COUNT(*) > 1;
--
-- 4. Verify no duplicates in updates:
--    SELECT project_id, update_number, COUNT(*)
--    FROM project_client_updates
--    GROUP BY project_id, update_number
--    HAVING COUNT(*) > 1;
--
-- 5. Compare legacy vs canonical row counts:
--    SELECT 'client_commitments' AS tbl, COUNT(*) FROM client_commitments
--    UNION ALL
--    SELECT 'project_client_commitments', COUNT(*) FROM project_client_commitments;
--
--    SELECT 'client_updates' AS tbl, COUNT(*) FROM client_updates
--    UNION ALL
--    SELECT 'project_client_updates', COUNT(*) FROM project_client_updates;
--
-- VERIFICATION REPORT:
--   ✓ All legacy rows should appear in canonical tables (migrated_from_legacy = true)
--   ✓ No duplicate rows under the conflict targets
--   ✓ Status values should be uppercase in canonical tables
--   ✓ Legacy tables remain intact (not dropped) for rollback safety
-- ============================================================
