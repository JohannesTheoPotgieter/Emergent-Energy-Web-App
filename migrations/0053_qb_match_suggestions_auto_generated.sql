-- Phase 3 — distinguish auto-suggest engine output from manual /find runs
-- so the inbox can filter to engine-generated suggestions only.
-- Additive + idempotent per the project's migration policy.

ALTER TABLE "quickbooks_match_suggestions"
  ADD COLUMN IF NOT EXISTS "auto_generated" boolean DEFAULT false NOT NULL;
