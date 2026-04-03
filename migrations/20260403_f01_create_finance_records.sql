-- Migration: 20260403_f01_create_finance_records.sql
-- Phase F.1: Create finance.finance_records + finance.finance_record_events.
-- Unified financial spine: cost lines, revenue lines, POs, payment requests,
-- invoice captures, procurement items, and change requests (VOs) land as
-- finance_records. Each lifecycle stage (PO raised, invoice received, payment made)
-- is captured as a finance_record_event for full audit trail.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. finance.finance_records — unified financial spine
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.finance_records (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_entity_id      INTEGER,
  legacy_entity_table   TEXT NOT NULL,
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  party_id              BIGINT REFERENCES core.parties(id),
  financial_type        TEXT NOT NULL,
  direction             TEXT NOT NULL,
  title                 TEXT,
  amount_ex_vat         NUMERIC(15,2),
  vat_amount            NUMERIC(15,2),
  currency              TEXT NOT NULL DEFAULT 'ZAR',
  status                TEXT NOT NULL DEFAULT 'draft',
  fiscal_period_id      BIGINT REFERENCES finance.fiscal_periods(id),
  record_data           JSONB NOT NULL DEFAULT '{}',
  import_source         TEXT,
  has_frontend_override BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_entity_table, legacy_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_records_project_instance_id
  ON finance.finance_records (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_finance_records_financial_type
  ON finance.finance_records (financial_type);

CREATE INDEX IF NOT EXISTS idx_finance_records_direction
  ON finance.finance_records (direction);

CREATE INDEX IF NOT EXISTS idx_finance_records_status
  ON finance.finance_records (status);

CREATE INDEX IF NOT EXISTS idx_finance_records_party_id
  ON finance.finance_records (party_id);

CREATE INDEX IF NOT EXISTS idx_finance_records_fiscal_period_id
  ON finance.finance_records (fiscal_period_id);

COMMENT ON TABLE finance.finance_records IS
  'Phase F.1: Unified financial spine. Consolidates cost_lines, revenue_lines, purchase_orders, payment_requests, invoice_captures, procurement_items, and change_requests. Type-specific data in record_data JSONB. Lifecycle stages tracked in finance_record_events.';

-- -------------------------------------------------------
-- 2. finance.finance_record_events — lifecycle audit trail
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.finance_record_events (
  id                    BIGSERIAL PRIMARY KEY,
  finance_record_id     BIGINT NOT NULL REFERENCES finance.finance_records(id),
  event_type            TEXT NOT NULL,
  event_date            TIMESTAMP NOT NULL,
  actor_party_id        BIGINT REFERENCES core.parties(id),
  from_status           TEXT,
  to_status             TEXT,
  amount                NUMERIC(15,2),
  event_data            JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_record_events_record_id
  ON finance.finance_record_events (finance_record_id);

CREATE INDEX IF NOT EXISTS idx_finance_record_events_event_type
  ON finance.finance_record_events (event_type);

CREATE INDEX IF NOT EXISTS idx_finance_record_events_event_date
  ON finance.finance_record_events (event_date);

CREATE INDEX IF NOT EXISTS idx_finance_record_events_actor
  ON finance.finance_record_events (actor_party_id);

COMMENT ON TABLE finance.finance_record_events IS
  'Phase F.1: Lifecycle audit trail for finance records. Each stage (po_raised, invoice_received, payment_requested, payment_made, import, frontend_edit, etc.) is a separate event preserving the full history.';

COMMIT;
