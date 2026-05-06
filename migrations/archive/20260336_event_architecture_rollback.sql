-- ============================================================
-- Rollback: Prompt 13 — Event Architecture Schema
-- ============================================================

-- Drop indexes
DROP INDEX IF EXISTS idx_event_processing_log_event_id;
DROP INDEX IF EXISTS idx_event_processing_log_status;
DROP INDEX IF EXISTS idx_event_subscriptions_event_type;
DROP INDEX IF EXISTS idx_event_subscriptions_active;
DROP INDEX IF EXISTS idx_domain_events_event_type;
DROP INDEX IF EXISTS idx_domain_events_aggregate;
DROP INDEX IF EXISTS idx_domain_events_project_id;
DROP INDEX IF EXISTS idx_domain_events_created_at;
DROP INDEX IF EXISTS idx_domain_events_unprocessed;

-- Drop tables (order matters for FK)
DROP TABLE IF EXISTS event_processing_log;
DROP TABLE IF EXISTS event_subscriptions;
DROP TABLE IF EXISTS domain_events;

-- Drop enums
DROP TYPE IF EXISTS event_processing_status;
DROP TYPE IF EXISTS domain_event_status;
