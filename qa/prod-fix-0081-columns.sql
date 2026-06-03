-- ============================================================================
-- PROD FIX: apply migration 0081's columns (schema-drift repair)
-- Generated: 2026-06-03   TARGET: PRODUCTION (Neon) ONLY
--
-- Why: prod's normalized_cost_line_actuals is missing two columns that the
-- running app expects, causing runtime errors:
--   column "invoice_date_font_color" does not exist
-- Migration 0081 is recorded as applied in prod's drizzle journal but the
-- columns were never actually created ("journaled but not applied"), so
-- drizzle-kit migrate skips 0081 and never repairs them.
--
-- Safe & idempotent: additive ADD COLUMN IF NOT EXISTS, both nullable, no
-- default, no data rewrite, no locks of consequence. Matches migration 0081
-- and the dev schema exactly. Re-running it is harmless.
-- ============================================================================

ALTER TABLE normalized_cost_line_actuals
  ADD COLUMN IF NOT EXISTS invoice_date_font_color text;

ALTER TABLE normalized_cost_line_actuals
  ADD COLUMN IF NOT EXISTS invoice_date_confirmed boolean;

-- Verify: both rows should now be present.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'normalized_cost_line_actuals'
  AND column_name IN ('invoice_date_font_color', 'invoice_date_confirmed')
ORDER BY column_name;
