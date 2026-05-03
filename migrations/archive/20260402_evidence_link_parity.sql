-- Migration: 20260402_evidence_link_parity.sql
-- Phase 1B Blocker 5: Add SharePoint fields to documentation.document_versions
BEGIN;

-- Enrich document_versions with SharePoint fields lost during foundation flattening
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS site_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS drive_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS file_item_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS web_url TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;

-- Index for evidence parity queries: find all file-sourced version rows per document
CREATE INDEX IF NOT EXISTS idx_document_versions_file_lineage
  ON documentation.document_versions (document_id)
  WHERE legacy_deliverable_file_id IS NOT NULL;

COMMENT ON COLUMN documentation.document_versions.site_id IS 'SharePoint site ID from deliverable_files, backfilled via legacy_deliverable_file_id join';
COMMENT ON COLUMN documentation.document_versions.drive_id IS 'SharePoint drive ID from deliverable_files';
COMMENT ON COLUMN documentation.document_versions.file_item_id IS 'SharePoint file item ID from deliverable_files';
COMMENT ON COLUMN documentation.document_versions.web_url IS 'Direct web URL from deliverable_files (note: storage_path already holds this for file-sourced rows from foundation backfill)';
COMMENT ON COLUMN documentation.document_versions.is_approved IS 'Approval flag from deliverable_files.is_approved';

COMMIT;
