-- Rollback: 20260402_party_abstraction_rollback.sql
-- WARNING: Drops the entire core.parties table and all backfilled party data.
BEGIN;
DROP INDEX IF EXISTS core.idx_parties_name_canonical;
DROP INDEX IF EXISTS core.idx_parties_party_type;
DROP TABLE IF EXISTS core.parties;
COMMIT;
