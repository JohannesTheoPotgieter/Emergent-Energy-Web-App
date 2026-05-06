-- Step B2: Create Site entity — first-class representation of physical locations
-- New table, zero impact on existing data

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  site_name TEXT NOT NULL,
  address TEXT,
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(10, 7),
  municipality TEXT,
  utility_authority TEXT,
  landlord TEXT,
  tenant TEXT,
  roof_type TEXT,              -- 'flat_roof', 'pitched_roof', 'ground_mount', 'carport', 'other'
  site_constraints TEXT,
  hse_constraints TEXT,
  access_rules TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'inactive', 'decommissioned'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- Link projects to sites (nullable FK — existing projects unaffected)
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
