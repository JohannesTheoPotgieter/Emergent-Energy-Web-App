-- B2 (audit closeout) — PO approver delegation columns
--
-- Per direction from the breakdown discussion:
--   "CFO can do any, Program finance manager, Program manager, and COO can
--    approve purchase orders, but a user should assign who they want to
--    approve it, it should then delegate if that user is not available."
--
-- And the follow-up: delegation is MANUAL ONLY (no timeout-based auto-route,
-- no out-of-office flag, no magic).
--
-- This migration adds three nullable columns to po_review_assignments so a
-- reviewer (or an admin) can explicitly reassign an approval to another
-- eligible approver while preserving a full audit trail of who delegated
-- to whom and why.
--
-- Companion changes in server/po-routes.ts:
--   1. POST /api/po/:poId/submit now requires an `assignedApproverUserId`
--      in the request body and creates a single assignment (not a pool).
--   2. POST /api/po/:poId/review rejects callers who are not the currently
--      assigned approver, with an override path for CFO / CEO_ADMIN.
--   3. POST /api/po/:poId/delegate is the manual-reassignment endpoint
--      that writes delegatedToUserId / delegatedAt / delegationReason on
--      the outgoing assignment and creates a fresh row for the new
--      assignee.
--   4. GET /api/po/eligible-approvers returns the role whitelist so the
--      UI can populate the approver picker.
--
-- Rollback: 20260412_po_approver_delegation_rollback.sql

BEGIN;

ALTER TABLE po_review_assignments
  ADD COLUMN IF NOT EXISTS delegated_to_user_id integer REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE po_review_assignments
  ADD COLUMN IF NOT EXISTS delegated_at timestamptz;

ALTER TABLE po_review_assignments
  ADD COLUMN IF NOT EXISTS delegation_reason text;

-- Partial index: "active assignments" — decision pending AND not yet delegated.
-- This is the hot query in the approval path and the delegation enforcement.
CREATE INDEX IF NOT EXISTS idx_po_review_active
  ON po_review_assignments (purchase_order_id, reviewer_user_id)
  WHERE decision = 'pending' AND delegated_to_user_id IS NULL;

COMMENT ON COLUMN po_review_assignments.delegated_to_user_id IS
  'B2: when set, this assignment was manually delegated to another reviewer. References users(id) for the self-FK delegation chain.';
COMMENT ON COLUMN po_review_assignments.delegated_at IS
  'B2: timestamp of the delegation action.';
COMMENT ON COLUMN po_review_assignments.delegation_reason IS
  'B2: free-text reason for the delegation (e.g. "on leave until 2026-04-20").';

COMMIT;
