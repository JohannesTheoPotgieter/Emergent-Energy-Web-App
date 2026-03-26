-- Step B8: Universalize Approval Engine — extend approvals table for all approval types
-- Additive columns only — existing approvals continue to work

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approval_type TEXT;        -- 'handover', 'budget', 'vo', 'procurement', 'gate', 'handover_pack', 'exception'
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'normal'; -- 'critical', 'high', 'normal', 'low'
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS evidence_links TEXT;       -- JSON array of evidence links
