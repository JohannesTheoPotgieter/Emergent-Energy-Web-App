-- Turn on 4-5 ready feature flags that gate fully-built, reviewed features.
--
-- Flags enabled here:
--   * role_aware_ux              - Role-aware landing and UX
--   * cleaned_admin_visibility   - Progressive admin visibility cleanup
--   * onboarding_tour            - Navigation onboarding tour overlay
--   * micro_walkthrough          - Contextual micro-walkthrough guidance overlays
--   * action_launchpad           - Standalone action launchpad page
--
-- This migration is intentionally scoped: it does NOT touch any other flags,
-- especially not the promoted_* or migration_bridge_* flags that are part of
-- the paused schema migration and must stay OFF / frozen.
--
-- Idempotent: safe to run multiple times. Uses ON CONFLICT DO UPDATE so the
-- flag rows are upserted to 'true' whether or not they already exist in
-- app_settings (which is populated lazily via ensureRolloutFeatureFlags at
-- startup using each flag's defaultValue from shared/feature-flags.ts).

INSERT INTO app_settings (key, value, updated_by, updated_at)
VALUES
  ('role_aware_ux',            'true', 'system:20260415_enable_ready_feature_flags', now()),
  ('cleaned_admin_visibility', 'true', 'system:20260415_enable_ready_feature_flags', now()),
  ('onboarding_tour',          'true', 'system:20260415_enable_ready_feature_flags', now()),
  ('micro_walkthrough',        'true', 'system:20260415_enable_ready_feature_flags', now()),
  ('action_launchpad',         'true', 'system:20260415_enable_ready_feature_flags', now())
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
