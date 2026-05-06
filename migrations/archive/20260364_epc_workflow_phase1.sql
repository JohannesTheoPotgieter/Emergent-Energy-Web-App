-- EPC Workflow Phase 1: PO Approval + Payment Request + Payment Batch + Proof of Payment
-- This migration:
--   1. ALTERs purchase_orders to add workflow columns
--   2. ALTERs procurement_items to add FK to purchase_orders
--   3. ALTERs invoice_captures to add FK to purchase_orders + qb_sync_status
--   4. CREATEs po_review_assignments, payment_requests, payment_batches, payment_batch_items, proof_of_payment

-- ===================== NEW ENUMS =====================

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM ('draft', 'submitted', 'in_review', 'requires_info', 'blocked', 'approved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_request_status AS ENUM ('new', 'in_review', 'loaded_for_payment', 'proof_attached', 'complete', 'requires_info', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_batch_status AS ENUM ('preparing', 'submitted', 'approved', 'released', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE po_review_decision AS ENUM ('pending', 'approved', 'requires_info', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===================== ALTER purchase_orders =====================
-- Add workflow columns to existing purchase_orders table

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS counterparty_id INTEGER REFERENCES counterparties(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_id INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS evidence_evaluation_id INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Migrate existing status values: 'sent' → 'submitted' for the new workflow
UPDATE purchase_orders SET status = 'submitted' WHERE status = 'sent';

-- ===================== ALTER procurement_items =====================
-- Add real FK on po_id to purchase_orders

-- First clean up any orphaned po_id values that don't reference real POs
UPDATE procurement_items SET po_id = NULL WHERE po_id IS NOT NULL AND po_id NOT IN (SELECT id FROM purchase_orders);

ALTER TABLE procurement_items DROP CONSTRAINT IF EXISTS procurement_items_po_id_fkey;
ALTER TABLE procurement_items ADD CONSTRAINT procurement_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;

-- ===================== ALTER invoice_captures =====================
-- Add real FK on linked_po_id to purchase_orders + qb_sync_status

UPDATE invoice_captures SET linked_po_id = NULL WHERE linked_po_id IS NOT NULL AND linked_po_id NOT IN (SELECT id FROM purchase_orders);

ALTER TABLE invoice_captures DROP CONSTRAINT IF EXISTS invoice_captures_linked_po_id_fkey;
ALTER TABLE invoice_captures ADD CONSTRAINT invoice_captures_linked_po_id_fkey FOREIGN KEY (linked_po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE invoice_captures ADD COLUMN IF NOT EXISTS qb_sync_status TEXT DEFAULT 'not_synced';
ALTER TABLE invoice_captures ADD COLUMN IF NOT EXISTS document_drive_id TEXT;
ALTER TABLE invoice_captures ADD COLUMN IF NOT EXISTS document_item_id TEXT;

-- ===================== CREATE po_review_assignments =====================

CREATE TABLE IF NOT EXISTS po_review_assignments (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_role TEXT NOT NULL,
  decision po_review_decision NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_review_po_id ON po_review_assignments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_review_reviewer ON po_review_assignments(reviewer_user_id);

-- ===================== CREATE payment_requests =====================

CREATE TABLE IF NOT EXISTS payment_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  purchase_order_id INTEGER REFERENCES purchase_orders(id),
  invoice_capture_id INTEGER REFERENCES invoice_captures(id),
  counterparty_id INTEGER REFERENCES counterparties(id),
  procurement_item_id INTEGER REFERENCES procurement_items(id),
  amount DECIMAL(15,2) NOT NULL,
  due_date DATE,
  status payment_request_status NOT NULL DEFAULT 'new',
  submitted_by_user_id INTEGER NOT NULL REFERENCES users(id),
  cutoff_date DATE,
  evidence_evaluation_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_req_project ON payment_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_req_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_req_cutoff ON payment_requests(cutoff_date);

-- ===================== CREATE payment_batches =====================

CREATE TABLE IF NOT EXISTS payment_batches (
  id SERIAL PRIMARY KEY,
  batch_number TEXT NOT NULL UNIQUE,
  cutoff_date DATE NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  status payment_batch_status NOT NULL DEFAULT 'preparing',
  prepared_by_user_id INTEGER NOT NULL REFERENCES users(id),
  approved_by_user_id INTEGER REFERENCES users(id),
  released_by_user_id INTEGER REFERENCES users(id),
  approval_id INTEGER,
  approved_at TIMESTAMP,
  released_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_batch_status ON payment_batches(status);
CREATE INDEX IF NOT EXISTS idx_payment_batch_cutoff ON payment_batches(cutoff_date);

-- ===================== CREATE payment_batch_items =====================

CREATE TABLE IF NOT EXISTS payment_batch_items (
  id SERIAL PRIMARY KEY,
  payment_batch_id INTEGER NOT NULL REFERENCES payment_batches(id) ON DELETE CASCADE,
  payment_request_id INTEGER NOT NULL REFERENCES payment_requests(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_item_batch ON payment_batch_items(payment_batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_item_request ON payment_batch_items(payment_request_id);

-- ===================== CREATE proof_of_payment =====================

CREATE TABLE IF NOT EXISTS proof_of_payment (
  id SERIAL PRIMARY KEY,
  payment_request_id INTEGER REFERENCES payment_requests(id),
  payment_batch_id INTEGER REFERENCES payment_batches(id),
  bank_reference TEXT,
  document_drive_id TEXT,
  document_item_id TEXT,
  document_url TEXT,
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pop_request ON proof_of_payment(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_pop_batch ON proof_of_payment(payment_batch_id);
