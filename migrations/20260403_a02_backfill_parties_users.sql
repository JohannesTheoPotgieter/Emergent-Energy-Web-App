-- Backfill: 20260403_a02_backfill_parties_users.sql
-- Phase A.2: Set party_kind on existing rows, insert users as person parties
-- Idempotent: UPDATE guarded by WHERE NULL, INSERT uses ON CONFLICT DO NOTHING
-- Must run AFTER: 20260403_a01_expand_parties_add_party_kind.sql
BEGIN;

-- Backfill party_kind for existing organisation rows
UPDATE core.parties SET party_kind = 'organisation' WHERE party_kind IS NULL;

-- Insert users as person-kind parties
INSERT INTO core.parties (
  legacy_user_id, party_type, party_kind, name_canonical,
  contact_email, is_active, source_table
)
SELECT
  u.id, 'user', 'person', u.name,
  u.email, (u.deleted_at IS NULL), 'public.users'
FROM public.users u
ON CONFLICT (legacy_user_id) DO NOTHING;

COMMIT;
