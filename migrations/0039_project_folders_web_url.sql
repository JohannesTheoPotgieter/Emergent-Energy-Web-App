-- =========================================================================
-- 0039: project_folders.web_url for SharePoint deep-link affordance.
--
-- Captured at provisioning time from Graph driveItem.webUrl so the UI can
-- offer "Open in SharePoint" links without an extra round-trip per render.
--
-- Hand-authored, additive, idempotent. Companion to the Drizzle schema
-- change in shared/schema/documents.ts.
-- =========================================================================

ALTER TABLE "project_folders"
  ADD COLUMN IF NOT EXISTS "web_url" text;
