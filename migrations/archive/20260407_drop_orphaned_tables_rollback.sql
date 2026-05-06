-- Rollback for 20260407_drop_orphaned_tables.sql
-- BEST-EFFORT: The forward migration dropped 5 orphaned tables and 1 enum:
--   event_processing_log, event_subscriptions, domain_events,
--   derived_portfolio_kpis, derived_rag_summary,
--   event_processing_status (enum)
--
-- These tables were confirmed empty (0 rows in production) before being
-- dropped. A rollback cannot resurrect dropped tables or their data.
-- If you need to restore them, re-create from the original schema
-- definitions in version control history.
--
-- This rollback is a no-op that logs a notice for operator awareness.

BEGIN;

DO $$
BEGIN
  RAISE NOTICE '[ROLLBACK 20260407_drop_orphaned_tables] This is a best-effort no-op. '
    'The dropped tables (event_processing_log, event_subscriptions, domain_events, '
    'derived_portfolio_kpis, derived_rag_summary) and enum (event_processing_status) '
    'cannot be automatically restored. Consult version control history to re-create '
    'schemas if needed.';
END $$;

COMMIT;
