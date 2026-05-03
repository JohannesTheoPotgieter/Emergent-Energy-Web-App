-- Step C2: Enrich procurement items for standalone module
-- All additive nullable columns

ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS requisition_status TEXT DEFAULT 'none';    -- 'none', 'requested', 'approved', 'rfq_sent', 'quoted', 'po_issued'
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS rfq_sent_date DATE;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS quote_received_date DATE;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS quote_amount DECIMAL(15, 2);
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS boq_reference TEXT;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS delivery_expected_date DATE;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS delivery_actual_date DATE;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'not_ordered'; -- 'not_ordered', 'ordered', 'shipped', 'delivered', 'partial'
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS is_long_lead BOOLEAN DEFAULT false;
