-- Step B6: Enrich Change/VO entity with impact fields and approval linkage
-- All additive nullable columns

ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS change_type TEXT;         -- 'scope', 'cost', 'schedule', 'combined'
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS cause TEXT;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS client_linked BOOLEAN DEFAULT false;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS revenue_impact DECIMAL(15, 2);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS cos_impact DECIMAL(15, 2);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS margin_impact DECIMAL(15, 2);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS schedule_impact_days INTEGER;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS approval_id INTEGER REFERENCES approvals(id);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS evidence_link TEXT;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS final_decision TEXT;      -- 'approved', 'rejected', 'deferred'
