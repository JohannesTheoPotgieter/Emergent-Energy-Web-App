-- 0037: Add `is_active` flag to users (Task #110).
--
-- Admin-controlled active/inactive toggle, surfaced on the Manage Account
-- drawer. Defaults to `true` so every existing account is unaffected. The
-- column is honoured by the LocalStrategy login path, the Microsoft OAuth
-- callback, and the bearer/session resolver in server/auth-context.ts —
-- flipping a user to inactive blocks their next request.
--
-- Hand-authored, additive, idempotent. Companion to the Drizzle schema
-- change in shared/schema/users.ts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
