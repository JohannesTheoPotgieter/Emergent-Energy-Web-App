-- Rollback: 20260402_evidence_link_parity_rollback.sql
BEGIN;
DROP INDEX IF EXISTS documentation.idx_document_versions_file_lineage;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS site_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS drive_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS file_item_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS web_url;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS is_approved;
COMMIT;
