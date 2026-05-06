-- Task #34 follow-up: extend the existing shadow-row uniqueness on
-- pd_tickets to ignore soft-deleted rows. Without this, soft-deleting
-- a shadow ticket and re-creating one for the same opportunity would
-- collide on the original `pd_tickets_opportunity_shadow_unique` index.
-- Hand-authored, additive, idempotent.

BEGIN;

DROP INDEX IF EXISTS pd_tickets_opportunity_shadow_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pd_tickets_opportunity_shadow_unique
  ON pd_tickets (opportunity_id)
  WHERE opportunity_id IS NOT NULL
    AND project_id IS NULL
    AND deleted_at IS NULL;

COMMIT;
