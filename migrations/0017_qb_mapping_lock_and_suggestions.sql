-- Task #30 — QuickBooks integration hardening + admin-only fuzzy match & cascade.
--
-- Adds source attribution + admin lock columns to mapping tables and creates
-- the suggestion / cascade audit tables. All additions are NULLABLE / IF NOT
-- EXISTS so this migration is idempotent against environments where the
-- columns or tables already exist (e.g. dev pushed via drizzle-kit).

ALTER TABLE quickbooks_customer_mappings
  ADD COLUMN IF NOT EXISTS source            TEXT          NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence        DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS locked_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS locked_by         INTEGER,
  ADD COLUMN IF NOT EXISTS suggestion_run_id INTEGER;

ALTER TABLE quickbooks_vendor_mappings
  ADD COLUMN IF NOT EXISTS source            TEXT          NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence        DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS locked_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS locked_by         INTEGER,
  ADD COLUMN IF NOT EXISTS suggestion_run_id INTEGER;

CREATE TABLE IF NOT EXISTS quickbooks_match_suggestions (
  id                   SERIAL PRIMARY KEY,
  scope                TEXT NOT NULL,
  qb_realm_id          TEXT NOT NULL,
  app_entity_id        INTEGER,
  app_entity_label     TEXT,
  candidates           JSONB NOT NULL,
  requested_by         INTEGER,
  requested_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  accepted_at          TIMESTAMP,
  accepted_by          INTEGER,
  accepted_qb_id       TEXT,
  accepted_confidence  DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS quickbooks_match_suggestions_scope_idx
  ON quickbooks_match_suggestions (scope, qb_realm_id);

CREATE TABLE IF NOT EXISTS quickbooks_cascade_runs (
  id                   SERIAL PRIMARY KEY,
  suggestion_id        INTEGER,
  scope                TEXT NOT NULL,
  qb_realm_id          TEXT NOT NULL,
  source_entity_type   TEXT NOT NULL,
  source_entity_id     INTEGER,
  preview              JSONB NOT NULL,
  commit               JSONB,
  status               TEXT NOT NULL DEFAULT 'preview',
  triggered_by         INTEGER,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  committed_at         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS quickbooks_cascade_runs_suggestion_idx
  ON quickbooks_cascade_runs (suggestion_id);
CREATE INDEX IF NOT EXISTS quickbooks_cascade_runs_scope_idx
  ON quickbooks_cascade_runs (scope);
