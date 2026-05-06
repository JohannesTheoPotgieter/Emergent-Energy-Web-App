-- Backfill 06: Evidence SharePoint Fields
-- Updates documentation.document_versions with SharePoint fields from public.deliverable_files
-- Join key: document_versions.legacy_deliverable_file_id = deliverable_files.id (NOT version_id)
-- Idempotent via WHERE site_id IS NULL guard
-- Must run AFTER: 20260402_evidence_link_parity.sql
BEGIN;

UPDATE documentation.document_versions dv_promoted
SET
  site_id    = df.site_id,
  drive_id   = df.drive_id,
  file_item_id = df.file_item_id,
  web_url    = df.web_url,
  is_approved = df.is_approved
FROM public.deliverable_files df
WHERE dv_promoted.legacy_deliverable_file_id = df.id
  AND dv_promoted.site_id IS NULL;

COMMIT;
