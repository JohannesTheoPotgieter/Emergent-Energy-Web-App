-- Add soft-delete columns to qc_item_evidence
-- Previously the evidence delete route tried to set deletedAt/deletedBy
-- but the columns did not exist, causing silent failures.
ALTER TABLE qc_item_evidence ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE qc_item_evidence ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
