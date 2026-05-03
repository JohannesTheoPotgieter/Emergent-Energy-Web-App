-- Fix: ensure the composite unique constraint exists on notification_throttle
-- so that ON CONFLICT upserts work correctly for throttle deduplication.
-- The previous migration (20260344) had an invalid filename and may not have run.

-- Step 1: Remove duplicate rows (keep the most recent per group)
DELETE FROM notification_throttle a
USING notification_throttle b
WHERE a.id < b.id
  AND a.recipient_user_id = b.recipient_user_id
  AND a.event_type = b.event_type
  AND a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id;

-- Step 2: Create the unique index if it doesn't already exist
CREATE UNIQUE INDEX IF NOT EXISTS notification_throttle_recipient_event_entity
  ON notification_throttle (recipient_user_id, event_type, entity_type, entity_id);
