-- Migration: Add QB settlement fields to quickbooks_documents.
-- These columns are declared in shared/schema/integrations.ts (qbBalance,
-- qbPaymentStatus) and present in the baseline snapshot, but the original
-- migration was archived without ever being added to the journal — so neither
-- dev nor prod databases ever received them. Drizzle's auto-generated SELECT
-- in getQbDocumentId then 500s the QB-match approve flow.
--
-- qb_balance:        remaining unpaid balance (TotalAmt - sum of payments). 0 = fully settled.
-- qb_payment_status: derived 'paid' | 'partial' | 'unpaid' | null (unknown)
--
-- Additive + idempotent (IF NOT EXISTS) so re-running on a partially-fixed DB
-- is a safe no-op.

ALTER TABLE "quickbooks_documents"
  ADD COLUMN IF NOT EXISTS "qb_balance"        numeric(15, 2),
  ADD COLUMN IF NOT EXISTS "qb_payment_status" text;
