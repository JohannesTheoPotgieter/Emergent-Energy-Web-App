-- Rollback: 20260402_approval_type_support_rollback.sql
-- WARNING: Destroys all backfilled approval lineage data. The legacy_approval_id mapping is lost.
BEGIN;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS legacy_approval_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS approval_type;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS approval_category;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS title;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS project_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS related_entity_type;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS related_entity_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS requested_by_user_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS urgency;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS evidence_links;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS source_table;
COMMIT;
