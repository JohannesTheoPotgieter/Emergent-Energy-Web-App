-- Create the QuickBooks integration tables that were defined in the Drizzle
-- schema (shared/schema/integrations.ts) but never had a CREATE TABLE
-- migration.  Without these tables, any query against quickbooks_invoice_links
-- or quickbooks_customer_mappings crashes with:
--
--   ERROR 42P01: relation "quickbooks_invoice_links" does not exist
--
-- Both use IF NOT EXISTS so this migration is safe to re-run and will be a
-- no-op once the tables exist.

BEGIN;

-- ===================== quickbooks_invoice_links =====================

CREATE TABLE IF NOT EXISTS quickbooks_invoice_links (
  id                    SERIAL PRIMARY KEY,
  project_id            INTEGER,
  app_entity_type       TEXT NOT NULL,
  app_entity_id         INTEGER NOT NULL,
  qb_entity_type        TEXT NOT NULL,
  qb_entity_id          TEXT NOT NULL,
  qb_realm_id           TEXT NOT NULL,
  qb_doc_number         TEXT,
  qb_txn_date           TEXT,
  qb_amount             NUMERIC(15, 2),
  qb_counterparty_name  TEXT,
  match_type            TEXT NOT NULL DEFAULT 'manual',
  notes                 TEXT,
  confirmed_by          INTEGER,
  confirmed_at          TIMESTAMP NOT NULL DEFAULT now(),
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMP
);

-- Base 5-tuple uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_invoice_links_unique_idx
  ON quickbooks_invoice_links (app_entity_type, app_entity_id, qb_entity_type, qb_entity_id, qb_realm_id);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS quickbooks_invoice_links_project_idx
  ON quickbooks_invoice_links (project_id);
CREATE INDEX IF NOT EXISTS quickbooks_invoice_links_app_entity_idx
  ON quickbooks_invoice_links (app_entity_type, app_entity_id);

-- ===================== quickbooks_customer_mappings =====================

CREATE TABLE IF NOT EXISTS quickbooks_customer_mappings (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL,
  client_id         INTEGER,
  qb_customer_id    TEXT NOT NULL,
  qb_customer_name  TEXT,
  qb_realm_id       TEXT NOT NULL,
  notes             TEXT,
  created_by        INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMP
);

-- One active mapping per (project, realm)
CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_customer_mappings_project_idx
  ON quickbooks_customer_mappings (project_id, qb_realm_id);
CREATE INDEX IF NOT EXISTS quickbooks_customer_mappings_customer_idx
  ON quickbooks_customer_mappings (qb_customer_id);

COMMIT;
