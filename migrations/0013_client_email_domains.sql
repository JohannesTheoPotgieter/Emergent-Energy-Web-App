-- =========================================================================
-- Email-linking foundations — client email domain columns.
--
-- Adds primary_email_domain + additional_email_domains to the clients
-- table so that incoming Outlook emails can be auto-attributed to a
-- client when the sender's domain matches. See the email-linking design
-- in docs/overhaul/04-overnight-progress.md.
--
-- This is metadata only — the actual email-linking feature lands in a
-- later commit. Adding the schema now unblocks super users from filling
-- domains in via the clients UI in advance of that work.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "primary_email_domain" text;
--> statement-breakpoint

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "additional_email_domains" jsonb DEFAULT '[]'::jsonb;
