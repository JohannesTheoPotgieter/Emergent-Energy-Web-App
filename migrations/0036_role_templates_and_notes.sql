-- 0036: Role templates + notes columns (Task #101 — Roles & Permissions rework).
--
-- Adds the curated "role template" library that the new role-template-first
-- admin UI applies in one click, and an optional `notes` column on
-- role_permissions and user_permission_overrides so administrators can
-- record a one-line reason for any custom override.
--
-- Hand-authored, additive only, idempotent (`IF NOT EXISTS` everywhere).
-- Companion to the Drizzle schema additions in shared/schema/users.ts.
--
-- Existing primary-key types are NOT touched. New table uses `serial`,
-- matching every other PK in this codebase.

CREATE TABLE IF NOT EXISTS role_templates (
  id              serial PRIMARY KEY,
  key             text   NOT NULL UNIQUE,
  name            text   NOT NULL,
  summary         text   NOT NULL,
  category        text   NOT NULL,
  permissions     jsonb  NOT NULL,
  sections        text[] NOT NULL DEFAULT '{}'::text[],
  is_system       boolean NOT NULL DEFAULT true,
  seeded_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_templates_category_idx
  ON role_templates (category);

ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE user_permission_overrides
  ADD COLUMN IF NOT EXISTS notes text;
