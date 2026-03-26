-- Step B3: Create Opportunity entity — pre-Pipedrive, immediately useful for PD workflow
-- New table, nullable FKs to existing tables

CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  pipedrive_deal_id TEXT,
  client_id INTEGER REFERENCES clients(id),
  site_id INTEGER REFERENCES sites(id),
  deal_owner_user_id INTEGER REFERENCES users(id),
  stage TEXT DEFAULT 'prospect',              -- 'prospect', 'qualification', 'proposal', 'negotiation', 'won', 'lost'
  contract_type TEXT,                         -- 'PPA', 'EPC', 'lease', 'hybrid'
  funding_type TEXT,                          -- 'self_funded', 'third_party', 'blended'
  estimated_value DECIMAL(15, 2),
  estimated_kwp DECIMAL(12, 2),
  estimated_kwh DECIMAL(15, 2),
  proposal_issued_date DATE,
  expected_close_date DATE,
  signed_date DATE,
  handover_readiness TEXT DEFAULT 'not_ready', -- 'not_ready', 'in_preparation', 'awaiting_approval', 'ready', 'submitted', 'accepted', 'returned'
  commercial_risks TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',               -- 'active', 'won', 'lost', 'on_hold'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- Link projects to opportunities (nullable FK)
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS opportunity_id INTEGER REFERENCES opportunities(id);

-- Link PD tickets to opportunities (nullable FK)
ALTER TABLE pd_tickets ADD COLUMN IF NOT EXISTS opportunity_id INTEGER REFERENCES opportunities(id);
