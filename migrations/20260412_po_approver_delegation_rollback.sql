-- Rollback for 20260412_po_approver_delegation.sql
-- Drops the B2 delegation columns and index.

BEGIN;

DROP INDEX IF EXISTS idx_po_review_active;

ALTER TABLE po_review_assignments DROP COLUMN IF EXISTS delegation_reason;
ALTER TABLE po_review_assignments DROP COLUMN IF EXISTS delegated_at;
ALTER TABLE po_review_assignments DROP COLUMN IF EXISTS delegated_to_user_id;

COMMIT;
