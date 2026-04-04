-- Rollback: 20260403_f09_rollback_finance_records.sql
-- Reverses Phase F finance records: drops events then records (FK order).
BEGIN;

DROP TABLE IF EXISTS finance.finance_record_events;
DROP TABLE IF EXISTS finance.finance_records;

COMMIT;
