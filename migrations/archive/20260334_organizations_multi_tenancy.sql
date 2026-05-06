-- ============================================================
-- Prompt 11: Add organization_id to Foundation Entities
--
-- Creates organizations table and adds organization_id FK
-- to 10 Layer 0/1 tables for multi-tenancy future-proofing.
-- All existing rows auto-fill with DEFAULT 1 (Emergent Energy).
-- ============================================================

-- Step 1: Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Step 2: Seed default organization
INSERT INTO organizations (name, slug)
VALUES ('Emergent Energy', 'emergent-energy')
ON CONFLICT (slug) DO NOTHING;

-- Step 3: Add organization_id column to 10 foundation tables
-- DEFAULT 1 ensures all existing rows are auto-filled

-- users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);

-- clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_clients_organization_id ON clients(organization_id);

-- project_info
ALTER TABLE project_info
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_project_info_organization_id ON project_info(organization_id);

-- portfolios
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_portfolios_organization_id ON portfolios(organization_id);

-- counterparties
ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_counterparties_organization_id ON counterparties(organization_id);

-- qc_template
ALTER TABLE qc_template
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_qc_template_organization_id ON qc_template(organization_id);

-- eng_stage_templates
ALTER TABLE eng_stage_templates
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_eng_stage_templates_organization_id ON eng_stage_templates(organization_id);

-- phase_template
ALTER TABLE phase_template
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_phase_template_organization_id ON phase_template(organization_id);

-- app_settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_app_settings_organization_id ON app_settings(organization_id);

-- role_credentials
ALTER TABLE role_credentials
  ADD COLUMN IF NOT EXISTS organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_role_credentials_organization_id ON role_credentials(organization_id);
