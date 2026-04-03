-- Rollback: 20260403_a01_expand_parties_add_party_kind_rollback.sql
-- Reverses Phase A.2 expansion: removes user rows, drops new columns and index.
-- Safe: no app code reads from core.parties; no downstream FK dependencies.
BEGIN;

-- Remove user rows first (they depend on legacy_user_id column)
DELETE FROM core.parties WHERE source_table = 'public.users';

-- Drop index before dropping the column it references
DROP INDEX IF EXISTS core.idx_parties_party_kind;

-- Drop new columns
ALTER TABLE core.parties DROP COLUMN IF EXISTS legacy_user_id;
ALTER TABLE core.parties DROP COLUMN IF EXISTS legal_name;
ALTER TABLE core.parties DROP COLUMN IF EXISTS party_kind;

COMMIT;
