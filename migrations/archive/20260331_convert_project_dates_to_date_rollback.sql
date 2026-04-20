-- =============================================================================
-- Rollback: Restore projectExecutionState TEXT date columns from DATE
-- Date: 2026-03-31
--
-- Restores the original TEXT columns as canonical names.
-- Keeps the DATE columns as *_typed for reference.
-- Keeps the audit table (migration_unparseable_dates) intact.
--
-- Covers all 13 columns:
--   pd_handover_date, construction_start_date, commissioning_date,
--   om_handover_date, client_handover_date,
--   construction_start_actual, pd_handover_actual,
--   commissioning_actual, client_handover_actual,
--   signed_date, cp_signed_date,
--   site_establishment_date, site_establishment_actual
-- =============================================================================

ALTER TABLE project_execution_state RENAME COLUMN pd_handover_date TO pd_handover_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN pd_handover_date_legacy TO pd_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN construction_start_date TO construction_start_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN construction_start_date_legacy TO construction_start_date;

ALTER TABLE project_execution_state RENAME COLUMN commissioning_date TO commissioning_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN commissioning_date_legacy TO commissioning_date;

ALTER TABLE project_execution_state RENAME COLUMN om_handover_date TO om_handover_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN om_handover_date_legacy TO om_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN client_handover_date TO client_handover_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN client_handover_date_legacy TO client_handover_date;

ALTER TABLE project_execution_state RENAME COLUMN construction_start_actual TO construction_start_actual_typed;
ALTER TABLE project_execution_state RENAME COLUMN construction_start_actual_legacy TO construction_start_actual;

ALTER TABLE project_execution_state RENAME COLUMN pd_handover_actual TO pd_handover_actual_typed;
ALTER TABLE project_execution_state RENAME COLUMN pd_handover_actual_legacy TO pd_handover_actual;

ALTER TABLE project_execution_state RENAME COLUMN commissioning_actual TO commissioning_actual_typed;
ALTER TABLE project_execution_state RENAME COLUMN commissioning_actual_legacy TO commissioning_actual;

ALTER TABLE project_execution_state RENAME COLUMN client_handover_actual TO client_handover_actual_typed;
ALTER TABLE project_execution_state RENAME COLUMN client_handover_actual_legacy TO client_handover_actual;

ALTER TABLE project_execution_state RENAME COLUMN signed_date TO signed_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN signed_date_legacy TO signed_date;

ALTER TABLE project_execution_state RENAME COLUMN cp_signed_date TO cp_signed_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN cp_signed_date_legacy TO cp_signed_date;

ALTER TABLE project_execution_state RENAME COLUMN site_establishment_date TO site_establishment_date_typed;
ALTER TABLE project_execution_state RENAME COLUMN site_establishment_date_legacy TO site_establishment_date;

ALTER TABLE project_execution_state RENAME COLUMN site_establishment_actual TO site_establishment_actual_typed;
ALTER TABLE project_execution_state RENAME COLUMN site_establishment_actual_legacy TO site_establishment_actual;

-- Note: migration_unparseable_dates table is intentionally preserved.
-- Note: _parse_text_to_date function is intentionally preserved.
