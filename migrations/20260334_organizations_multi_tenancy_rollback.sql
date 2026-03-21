-- ============================================================
-- Rollback: Prompt 11 — Organizations & Multi-tenancy Columns
--
-- Removes organization_id from all 10 tables, then drops
-- the organizations table.
-- No data loss — organization_id is metadata only.
-- ============================================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_users_organization_id;
DROP INDEX IF EXISTS idx_clients_organization_id;
DROP INDEX IF EXISTS idx_project_info_organization_id;
DROP INDEX IF EXISTS idx_portfolios_organization_id;
DROP INDEX IF EXISTS idx_counterparties_organization_id;
DROP INDEX IF EXISTS idx_qc_template_organization_id;
DROP INDEX IF EXISTS idx_eng_stage_templates_organization_id;
DROP INDEX IF EXISTS idx_phase_template_organization_id;
DROP INDEX IF EXISTS idx_app_settings_organization_id;
DROP INDEX IF EXISTS idx_role_credentials_organization_id;

-- Drop organization_id columns
ALTER TABLE users DROP COLUMN IF EXISTS organization_id;
ALTER TABLE clients DROP COLUMN IF EXISTS organization_id;
ALTER TABLE project_info DROP COLUMN IF EXISTS organization_id;
ALTER TABLE portfolios DROP COLUMN IF EXISTS organization_id;
ALTER TABLE counterparties DROP COLUMN IF EXISTS organization_id;
ALTER TABLE qc_template DROP COLUMN IF EXISTS organization_id;
ALTER TABLE eng_stage_templates DROP COLUMN IF EXISTS organization_id;
ALTER TABLE phase_template DROP COLUMN IF EXISTS organization_id;
ALTER TABLE app_settings DROP COLUMN IF EXISTS organization_id;
ALTER TABLE role_credentials DROP COLUMN IF EXISTS organization_id;

-- Drop organizations table
DROP TABLE IF EXISTS organizations;
