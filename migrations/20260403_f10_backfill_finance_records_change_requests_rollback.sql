-- Rollback: 20260403_f10_backfill_finance_records_change_requests_rollback.sql
-- Removes backfilled change_request / variation order records from finance.finance_records.
BEGIN;

-- Remove lifecycle events first (FK constraint)
DELETE FROM finance.finance_record_events
WHERE finance_record_id IN (
  SELECT id FROM finance.finance_records
  WHERE legacy_entity_table = 'public.change_requests'
    AND import_source = 'backfill_f10'
);

-- Remove the backfilled finance records
DELETE FROM finance.finance_records
WHERE legacy_entity_table = 'public.change_requests'
  AND import_source = 'backfill_f10';

COMMIT;
