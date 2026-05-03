-- Add QB settlement fields to quickbooks_documents
-- qb_balance: remaining unpaid balance (0 = fully paid)
-- qb_payment_status: derived 'paid' | 'partial' | 'unpaid' | null

ALTER TABLE quickbooks_documents
  ADD COLUMN IF NOT EXISTS qb_balance DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS qb_payment_status TEXT;
