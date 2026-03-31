-- =============================================================================
-- Migration: Consolidate legacy client tables into canonical tables
-- Date: 2026-03-31
-- Risk: MEDIUM
-- Transaction: CAN run inside a transaction.
--
-- Legacy tables:
--   project_client_commitments → canonical: client_commitments
--   project_client_updates     → canonical: client_updates
--
-- The canonical tables (client_commitments, client_updates) were defined but
-- never wired to active routes. This migration copies data from the legacy
-- tables into the canonical tables, then marks the legacy tables deprecated.
-- =============================================================================

-- ─── Step 1: Add migration tracking column ──────────────────────────────────

ALTER TABLE client_commitments
  ADD COLUMN IF NOT EXISTS migrated_from_legacy BOOLEAN DEFAULT false;

ALTER TABLE client_updates
  ADD COLUMN IF NOT EXISTS migrated_from_legacy BOOLEAN DEFAULT false;


-- ─── Step 2: Copy legacy commitments to canonical table ─────────────────────
-- Conflict target: match on (project_id, commitment_text, committed_date)
-- to avoid duplicating rows if migration is re-run.

INSERT INTO client_commitments (
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
  pcc.project_id,
  pcc.stage_code_created,
  pcc.commitment_text,
  pcc.committed_by_user_id,
  pcc.committed_date,
  pcc.delivery_stage_code,
  -- Map status: legacy uses OPEN/DELIVERED; canonical uses open/delivered
  LOWER(COALESCE(pcc.status, 'open')),
  pcc.delivered_date,
  pcc.notes,
  pcc.created_at,
  true
FROM project_client_commitments pcc
WHERE NOT EXISTS (
  SELECT 1 FROM client_commitments cc
  WHERE cc.project_id = pcc.project_id
    AND cc.commitment_text = pcc.commitment_text
    AND cc.committed_date = pcc.committed_date
);


-- ─── Step 3: Copy legacy updates to canonical table ─────────────────────────
-- Conflict target: match on (project_id, update_number) since
-- project_client_updates has a unique constraint pcu_project_update_uq.

INSERT INTO client_updates (
  project_id,
  update_number,
  last_client_update_date,
  next_client_update_due_date,
  client_update_status,
  progress_summary_text,
  completed_this_period_text,
  next_7_days_text,
  blockers_text,
  client_actions_required_text,
  attachment_urls,
  client_update_sent_by,
  reviewer_user_id,
  sent_date,
  created_at,
  migrated_from_legacy
)
SELECT
  pcu.project_id,
  pcu.update_number,
  pcu.due_date::timestamp,  -- legacy uses due_date (date) → canonical last_client_update_date (timestamp)
  NULL,  -- next_client_update_due_date not tracked in legacy
  LOWER(COALESCE(pcu.status, 'draft')),
  pcu.progress_summary_text,
  pcu.completed_this_period_text,
  pcu.next_7_days_text,
  pcu.blockers_text,
  pcu.client_actions_required_text,
  pcu.attachment_urls,
  pcu.sent_by_user_id,
  pcu.reviewer_user_id,
  pcu.sent_date,
  pcu.created_at,
  true
FROM project_client_updates pcu
WHERE NOT EXISTS (
  SELECT 1 FROM client_updates cu
  WHERE cu.project_id = pcu.project_id
    AND cu.update_number = pcu.update_number
);


-- ─── Step 4: Verification ──────────────────────────────────────────────────

DO $$
DECLARE
  legacy_commit_count INT;
  canonical_commit_count INT;
  migrated_commit_count INT;
  legacy_update_count INT;
  canonical_update_count INT;
  migrated_update_count INT;
BEGIN
  SELECT COUNT(*) INTO legacy_commit_count FROM project_client_commitments;
  SELECT COUNT(*) INTO canonical_commit_count FROM client_commitments;
  SELECT COUNT(*) INTO migrated_commit_count FROM client_commitments WHERE migrated_from_legacy = true;

  SELECT COUNT(*) INTO legacy_update_count FROM project_client_updates;
  SELECT COUNT(*) INTO canonical_update_count FROM client_updates;
  SELECT COUNT(*) INTO migrated_update_count FROM client_updates WHERE migrated_from_legacy = true;

  RAISE NOTICE '=== CLIENT TABLE CONSOLIDATION VERIFICATION ===';
  RAISE NOTICE 'Commitments: legacy=%, canonical total=%, migrated=%', legacy_commit_count, canonical_commit_count, migrated_commit_count;
  RAISE NOTICE 'Updates: legacy=%, canonical total=%, migrated=%', legacy_update_count, canonical_update_count, migrated_update_count;
  RAISE NOTICE '=== END VERIFICATION ===';
END $$;


-- ─── Step 5: Mark legacy tables as deprecated ──────────────────────────────
-- Add a comment to the legacy tables. Do NOT drop them yet (90-day window).

COMMENT ON TABLE project_client_commitments IS
  'DEPRECATED 2026-03-31: Replaced by client_commitments. Data migrated. Remove after 90 days of zero usage.';

COMMENT ON TABLE project_client_updates IS
  'DEPRECATED 2026-03-31: Replaced by client_updates. Data migrated. Remove after 90 days of zero usage.';
