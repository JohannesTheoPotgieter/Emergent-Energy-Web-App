-- C5 (audit closeout): drop legacy "signed" text fields from project_editable_fields.
--
-- The canonical source of truth for contract-signed status is now:
--   * project_execution_state.cp_signed     (boolean)            for cost proposal
--   * project_execution_state.signed_status (NONE/PENDING/SIGNED) for the EPC contract
--
-- The legacy text columns being dropped were never read by the UI render path
-- (the projects.tsx Financial Close cells render from cost_proposal_type /
-- epc_contract_type, not from these columns), so this drop is data-safe with
-- no UI fallout.
--
-- This migration BACKFILLS any "yes-like" legacy values into the canonical
-- columns first, so user-edited signed flags are preserved even though the UI
-- never displayed them.
--
-- Idempotent: re-running has no effect on rows already updated.
-- Wrapped in a transaction so a failure rolls back the column drop.

BEGIN;

-- Backfill cp_signed = TRUE where the legacy text field looks "signed"
UPDATE project_execution_state pes
SET cp_signed     = TRUE,
    cp_signed_date = COALESCE(pes.cp_signed_date, CURRENT_DATE),
    updated_at    = NOW()
FROM project_editable_fields pef
JOIN project_info pi ON pi.project_name = pef.project_name
WHERE pes.project_id = pi.id
  AND pef.cost_proposal_signed IS NOT NULL
  AND LOWER(TRIM(pef.cost_proposal_signed)) IN ('yes', 'y', 'true', 'signed', '1', 'completed');

-- Backfill signed_status = 'SIGNED' where the legacy text field looks "signed"
UPDATE project_execution_state pes
SET signed_status = 'SIGNED',
    updated_at    = NOW()
FROM project_editable_fields pef
JOIN project_info pi ON pi.project_name = pef.project_name
WHERE pes.project_id = pi.id
  AND pef.epc_contract_signed IS NOT NULL
  AND LOWER(TRIM(pef.epc_contract_signed)) IN ('yes', 'y', 'true', 'signed', '1', 'completed');

-- Drop the legacy columns
ALTER TABLE project_editable_fields DROP COLUMN IF EXISTS cost_proposal_signed;
ALTER TABLE project_editable_fields DROP COLUMN IF EXISTS epc_contract_signed;

COMMIT;
