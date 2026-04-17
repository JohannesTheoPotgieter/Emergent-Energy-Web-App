-- PR #660 follow-up: create the allocation-aware QuickBooks evidence tables
-- that were added to the Drizzle schema (shared/schema/integrations.ts) in
-- commit 54e6dcd but never had a CREATE TABLE migration shipped. Without
-- this migration, saveCostAllocationsForBill() and the bulk-assign endpoint
-- crash with "relation does not exist".
--
-- Both tables mirror the Drizzle definitions in integrations.ts exactly,
-- including the partial unique indexes that gate re-assignment after
-- soft-delete. Idempotent (IF NOT EXISTS) so safe to re-run.

BEGIN;

-- ===================== quickbooks_documents =====================

CREATE TABLE IF NOT EXISTS quickbooks_documents (
  id                     SERIAL PRIMARY KEY,
  project_id             INTEGER,
  qb_entity_type         TEXT NOT NULL DEFAULT 'bill',
  qb_entity_id           TEXT NOT NULL,
  qb_realm_id            TEXT NOT NULL,
  qb_doc_number          TEXT,
  qb_txn_date            TEXT,
  qb_counterparty_name   TEXT,
  qb_counterparty_id     TEXT,
  qb_amount_inc_vat      NUMERIC(15, 2),
  qb_tax_amount          NUMERIC(15, 2),
  qb_amount_ex_vat       NUMERIC(15, 2),
  amount_tolerance       NUMERIC(15, 4) NOT NULL DEFAULT 0.01,
  tax_status             TEXT NOT NULL DEFAULT 'KNOWN',
  assignment_status      TEXT NOT NULL DEFAULT 'UNASSIGNED',
  source_payload         JSONB,
  created_by             INTEGER,
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMP
);

-- One active document per (qb_entity_type, qb_entity_id, qb_realm_id).
-- Partial index so soft-deleted rows don't block re-ingest.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_documents_doc_realm_active
  ON quickbooks_documents (qb_entity_type, qb_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS quickbooks_documents_project_idx
  ON quickbooks_documents (project_id);
CREATE INDEX IF NOT EXISTS quickbooks_documents_doc_num_idx
  ON quickbooks_documents (qb_doc_number);
CREATE INDEX IF NOT EXISTS quickbooks_documents_counterparty_idx
  ON quickbooks_documents (qb_counterparty_name);

-- ===================== quickbooks_cost_allocations =====================

CREATE TABLE IF NOT EXISTS quickbooks_cost_allocations (
  id                       SERIAL PRIMARY KEY,
  quickbooks_document_id   INTEGER NOT NULL
                             REFERENCES quickbooks_documents(id) ON DELETE RESTRICT,
  project_id               INTEGER,
  cost_line_id             INTEGER NOT NULL,
  amount_ex_vat            NUMERIC(15, 2) NOT NULL,
  match_type               TEXT NOT NULL DEFAULT 'manual',
  status                   TEXT NOT NULL DEFAULT 'active',
  reason                   TEXT,
  created_by               INTEGER,
  approved_by              INTEGER,
  approved_at              TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMP
);

-- One active allocation per (document, cost_line). Soft-replace pattern
-- relies on this — soft-deleted rows are allowed to duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_cost_alloc_doc_line_active
  ON quickbooks_cost_allocations (quickbooks_document_id, cost_line_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS quickbooks_cost_alloc_document_idx
  ON quickbooks_cost_allocations (quickbooks_document_id);
CREATE INDEX IF NOT EXISTS quickbooks_cost_alloc_cost_line_idx
  ON quickbooks_cost_allocations (cost_line_id);
CREATE INDEX IF NOT EXISTS quickbooks_cost_alloc_project_idx
  ON quickbooks_cost_allocations (project_id);

COMMIT;
