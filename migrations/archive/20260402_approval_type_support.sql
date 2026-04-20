-- Migration: 20260402_approval_type_support.sql
-- Phase 1B Blocker 2: Add approval type and scope columns to documentation.document_approvals
-- Additive only. All nullable.
BEGIN;

ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS legacy_approval_id INTEGER UNIQUE;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS approval_type TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS approval_category TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES core.projects(id);
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS related_entity_id INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS urgency TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS evidence_links TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS source_table TEXT;

COMMENT ON COLUMN documentation.document_approvals.legacy_approval_id IS 'FK to public.approvals.id for lineage tracking';
COMMENT ON COLUMN documentation.document_approvals.approval_type IS 'Mirrors public.approvals.approval_type: handover/budget/vo/procurement/gate/exception/general/etc';
COMMENT ON COLUMN documentation.document_approvals.approval_category IS 'Mirrors public.approvals.approval_category for classification';
COMMENT ON COLUMN documentation.document_approvals.project_id IS 'Direct project FK for per-project approval queries without document join';

COMMIT;
