-- =========================================================================
-- App screen settings — admin-controlled per-screen on/off toggles.
--
-- screenId matches the `id` field of PAGE_REGISTRY entries.
-- Only screens explicitly set to false are stored; absence = enabled.
-- Idempotent + additive: safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "app_screen_settings" (
  "screen_id"           text PRIMARY KEY NOT NULL,
  "is_enabled"          boolean NOT NULL DEFAULT true,
  "updated_at"          timestamp NOT NULL DEFAULT now(),
  "updated_by_user_id"  integer
);
