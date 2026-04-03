-- Backfill: 20260403_a05_backfill_user_accounts.sql
-- Phase A.3: Populate core.user_accounts from public.users via core.parties.
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_a04_create_user_accounts.sql
BEGIN;

INSERT INTO core.user_accounts (party_id, legacy_user_id, email, status, created_at)
SELECT
  p.id,
  u.id,
  u.email,
  CASE WHEN u.deleted_at IS NULL THEN 'active' ELSE 'inactive' END,
  u.created_at
FROM public.users u
JOIN core.parties p ON p.legacy_user_id = u.id
ON CONFLICT (legacy_user_id) DO NOTHING;

COMMIT;
