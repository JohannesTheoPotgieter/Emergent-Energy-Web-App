-- 0033: Add `location` to users.
--
-- Free-text office / region descriptor used by the Company Team page
-- (`/team`) and editable by admins from Roles & Permissions > Users.
-- Until this column existed the team directory rendered "Data
-- unavailable" for every person's location card. Task #97.
--
-- Additive, idempotent, hand-authored. Companion to the Drizzle schema
-- change in shared/schema/users.ts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location text;
