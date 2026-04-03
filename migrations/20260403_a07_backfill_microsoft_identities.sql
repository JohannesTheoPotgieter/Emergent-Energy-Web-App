-- Backfill: 20260403_a07_backfill_microsoft_identities.sql
-- Phase A.3b: Populate core.microsoft_identities from public.users + ms_accounts.
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_a06_create_microsoft_identities.sql
BEGIN;

-- Insert one row per user that has a microsoft_id.
-- tenant_id: prefer ms_accounts.tenant_id if available, otherwise fall back to env default.
-- email: prefer ms_accounts.email (MS Graph canonical), otherwise users.email.
INSERT INTO core.microsoft_identities (user_account_id, microsoft_user_id, tenant_id, email)
SELECT
  ua.id,
  u.microsoft_id,
  COALESCE(ms.tenant_id, 'd6319480-d61b-4f33-adac-b7bc740c2fad'),
  COALESCE(ms.email, u.email)
FROM public.users u
JOIN core.user_accounts ua ON ua.legacy_user_id = u.id
LEFT JOIN ms_accounts ms ON ms.user_id = u.id AND ms.status = 'active'
WHERE u.microsoft_id IS NOT NULL AND u.microsoft_id <> ''
ON CONFLICT (user_account_id) DO NOTHING;

COMMIT;
