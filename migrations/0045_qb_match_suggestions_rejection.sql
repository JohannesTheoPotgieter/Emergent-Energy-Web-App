-- Adds rejection + manual-override audit columns to quickbooks_match_suggestions
-- so the Find QB Matches review flow can record approve / reject / manual
-- decisions on a per-suggestion basis without losing the candidate list.
--
-- Additive only. All columns are nullable so existing rows stay valid.

ALTER TABLE quickbooks_match_suggestions
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP NULL;

ALTER TABLE quickbooks_match_suggestions
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER NULL;

ALTER TABLE quickbooks_match_suggestions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;

ALTER TABLE quickbooks_match_suggestions
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE;
