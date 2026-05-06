-- Add unique constraint on notification_throttle for proper upsert behavior
-- First remove any duplicates (keep the most recent)
DELETE FROM notification_throttle a
USING notification_throttle b
WHERE a.id < b.id
  AND a.recipient_user_id = b.recipient_user_id
  AND a.event_type = b.event_type
  AND a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id;

CREATE UNIQUE INDEX IF NOT EXISTS notification_throttle_recipient_event_entity
  ON notification_throttle (recipient_user_id, event_type, entity_type, entity_id);
