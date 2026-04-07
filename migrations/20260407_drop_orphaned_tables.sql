-- ============================================================
-- Migration: Drop 5 empty orphaned tables
-- Date: 2026-04-07
-- Context: These tables exist in the live DB with 0 rows.
--   They have zero runtime consumers (no Drizzle imports,
--   no raw SQL references). See architecture baseline for
--   full audit trail.
--
-- Tables dropped (all confirmed 0 rows in production):
--   1. event_processing_log  (FK to domain_events — drop first)
--   2. event_subscriptions
--   3. domain_events
--   4. derived_portfolio_kpis
--   5. derived_rag_summary
--
-- Also drops the event_processing_status enum (only consumer
-- was event_processing_log).
--
-- Tables NOT dropped (schema-only, never existed in live DB):
--   approval_workflows, audit_trail, file_versions,
--   notification_preferences — removed from Drizzle schema only.
--
-- Tables NOT dropped (have data):
--   dashboard_widget_config (2 rows), fiscal_years (6 rows)
-- ============================================================

-- Drop order respects FK: event_processing_log references domain_events
DROP TABLE IF EXISTS event_processing_log;
DROP TABLE IF EXISTS event_subscriptions;
DROP TABLE IF EXISTS domain_events;
DROP TABLE IF EXISTS derived_portfolio_kpis;
DROP TABLE IF EXISTS derived_rag_summary;

-- Drop the orphaned enum (only consumer was event_processing_log)
DROP TYPE IF EXISTS event_processing_status;
