-- ROLLBACK for 20260412_drop_legacy_signed_text_fields.sql
--
-- Restores the legacy `cost_proposal_signed` and `epc_contract_signed` text columns.
-- WARNING: the original text values are lost — only the canonical boolean / enum
-- state on project_execution_state is preserved. After running this rollback the
-- restored columns will be NULL for every row.

BEGIN;

ALTER TABLE project_editable_fields ADD COLUMN IF NOT EXISTS cost_proposal_signed text;
ALTER TABLE project_editable_fields ADD COLUMN IF NOT EXISTS epc_contract_signed text;

COMMIT;
