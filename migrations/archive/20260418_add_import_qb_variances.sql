-- Smart Import × QuickBooks precedence: variance audit log
--
-- Records every field-level disagreement between what the workbook claimed
-- and what QuickBooks holds, when a row is QB-linked. The precedence rule
-- (QB wins on amount, VAT, invoice number, invoice date, paid date, in-bank
-- date) means the workbook value is silently discarded; this table is the
-- audit trail that finance can use to reconcile the difference.
--
-- Additive migration. Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.import_qb_variances (
  id                  SERIAL PRIMARY KEY,
  import_run_id       INTEGER NOT NULL,
  project_id          INTEGER,
  app_entity_type     TEXT NOT NULL,         -- 'cost_line' | 'revenue_line'
  app_entity_id       INTEGER NOT NULL,      -- normalized_cost_lines.id or normalized_revenue_lines.id
  qb_link_id          INTEGER,               -- quickbooks_invoice_links.id at write time
  qb_doc_id           INTEGER,               -- quickbooks_documents.id at write time
  qb_realm_id         TEXT,
  field_name          TEXT NOT NULL,         -- 'amountExVat' | 'invoiceNumber' | ...
  workbook_value      TEXT,                  -- string-coerced for audit display
  qb_value            TEXT,
  resolution          TEXT NOT NULL,         -- 'qb_locked' | 'auto_realised' | 'missing_preserved'
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_qb_variances_run_idx
  ON public.import_qb_variances (import_run_id);

CREATE INDEX IF NOT EXISTS import_qb_variances_project_idx
  ON public.import_qb_variances (project_id);

CREATE INDEX IF NOT EXISTS import_qb_variances_app_entity_idx
  ON public.import_qb_variances (app_entity_type, app_entity_id);
