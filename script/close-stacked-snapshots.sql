-- ============================================================================
-- script/close-stacked-snapshots.sql
-- ----------------------------------------------------------------------------
-- One-shot cleanup for stacked / duplicate active rows in the temporal cost
-- and revenue tables. Complements `script/dedupe-cost-lines.sql` (which
-- only targets duplicates that share an invoice_number) by also collapsing
-- duplicates whose identity falls back to the description / counterparty
-- composite key.
--
-- Strategy
-- --------
-- This DOES NOT prune by snapshot_run_id. Under the incremental import
-- model, active rows legitimately span multiple snapshot_run_ids because
-- UNCHANGED rows are not reinserted on every run. Closing "earlier
-- snapshots" would therefore destroy valid current-state rows.
--
-- Instead this script collapses duplicates per project by **business key**:
--
--   PRIMARY KEY  : (project_id, lower(trim(invoice_number)))
--                  applied when invoice_number is non-empty
--   FALLBACK KEY : (project_id, lower(trim(sub_project_name)),
--                   lower(trim(cost_category)),
--                   lower(trim(counterparty_name)),
--                   lower(trim(description)))
--                  applied when invoice_number is empty
--
-- Within each (project, key) group, keep the row with the highest id
-- (latest insert) and soft-close the rest by setting effective_to = now().
--
-- Safety
-- ------
--   * Soft-close only — no hard deletes; rerunning is a no-op.
--   * Wrapped in a transaction.
--   * Prints before/after counts so the operator can verify.
--   * Skips rows where ALL fallback fields are blank (they would otherwise
--     all collapse to a single sentinel key and corrupt the data).
--
-- How to run
-- ----------
--   psql "$DATABASE_URL" -f script/close-stacked-snapshots.sql
-- ============================================================================

BEGIN;

\echo '--- BEFORE: cost-line active-row inflation per project ---'
WITH base AS (
  SELECT ncl.project_id, p.project_name,
         CASE
           WHEN ncl.invoice_number IS NOT NULL AND trim(ncl.invoice_number) <> ''
             THEN 'INV:' || lower(trim(ncl.invoice_number))
           ELSE 'FB:'
                || COALESCE(lower(trim(ncl.sub_project_name)), '')                     || '|'
                || COALESCE(lower(trim(ncl.cost_category)), '')                        || '|'
                || COALESCE(lower(trim(ncl.counterparty_name)), '')                    || '|'
                || COALESCE(lower(trim(ncl.description)), '')                          || '|'
                || COALESCE(to_char(ncl.amount_ex_vat, 'FM999999999999990.00'), '')    || '|'
                || COALESCE(to_char(ncl.invoice_date, 'YYYY-MM-DD'), '')
         END AS bk
  FROM normalized_cost_lines ncl
  JOIN project_info p ON p.id = ncl.project_id
  WHERE ncl.effective_to IS NULL
    AND ncl.deleted_at IS NULL
)
SELECT project_name, COUNT(*) AS active_rows, COUNT(DISTINCT bk) AS distinct_keys,
       (COUNT(*) - COUNT(DISTINCT bk)) AS to_close
FROM base
GROUP BY project_name
HAVING COUNT(*) > COUNT(DISTINCT bk)
ORDER BY (COUNT(*) - COUNT(DISTINCT bk)) DESC;

-- ---- COST LINES: collapse duplicates by business key ----
-- Fallback (no invoice_number) includes amount_ex_vat + invoice_date so
-- legitimately distinct vendor lines (e.g. recurring charges) are NOT
-- collapsed. Only true duplicates (identical sub_project, category,
-- counterparty, description, amount AND invoice_date) are soft-closed.
WITH ranked AS (
  SELECT id, project_id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id,
             CASE
               WHEN invoice_number IS NOT NULL AND trim(invoice_number) <> ''
                 THEN 'INV:' || lower(trim(invoice_number))
               ELSE 'FB:'
                    || COALESCE(lower(trim(sub_project_name)), '')                 || '|'
                    || COALESCE(lower(trim(cost_category)), '')                    || '|'
                    || COALESCE(lower(trim(counterparty_name)), '')                || '|'
                    || COALESCE(lower(trim(description)), '')                      || '|'
                    || COALESCE(to_char(amount_ex_vat, 'FM999999999999990.00'), '')|| '|'
                    || COALESCE(to_char(invoice_date, 'YYYY-MM-DD'), '')
             END
           ORDER BY id DESC
         ) AS rn
  FROM normalized_cost_lines
  WHERE effective_to IS NULL
    AND deleted_at IS NULL
    AND (
      (invoice_number IS NOT NULL AND trim(invoice_number) <> '')
      OR (
        COALESCE(trim(sub_project_name), '') <> ''
        OR COALESCE(trim(cost_category), '') <> ''
        OR COALESCE(trim(counterparty_name), '') <> ''
        OR COALESCE(trim(description), '') <> ''
      )
    )
)
UPDATE normalized_cost_lines ncl
SET effective_to = now()
FROM ranked
WHERE ranked.id = ncl.id
  AND ranked.rn > 1;

-- ---- REVENUE LINES: collapse duplicates by tight business key ----
-- Use invoice_number as the primary identity when present; otherwise fall
-- back to the (sub_project, milestone/description, amount, invoice_date)
-- composite. Including amount + invoice_date prevents accidental closure
-- of legitimately distinct revenue rows that share a milestone label
-- (e.g. recurring monthly billings).
WITH ranked AS (
  SELECT id, project_id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id,
             CASE
               WHEN invoice_number IS NOT NULL AND trim(invoice_number) <> ''
                 THEN 'INV:' || lower(trim(invoice_number))
               ELSE 'FB:'
                    || COALESCE(lower(trim(sub_project_name)), '')                 || '|'
                    || COALESCE(lower(trim(milestone_name)),
                                lower(trim(description)), '')                      || '|'
                    || COALESCE(to_char(amount_ex_vat, 'FM999999999999990.00'), '')|| '|'
                    || COALESCE(to_char(invoice_date, 'YYYY-MM-DD'), '')
             END
           ORDER BY id DESC
         ) AS rn
  FROM normalized_revenue_lines
  WHERE effective_to IS NULL
    AND deleted_at IS NULL
    AND (
      (invoice_number IS NOT NULL AND trim(invoice_number) <> '')
      OR (
        COALESCE(trim(sub_project_name), '') <> ''
        OR COALESCE(trim(milestone_name), '') <> ''
        OR COALESCE(trim(description), '') <> ''
      )
    )
)
UPDATE normalized_revenue_lines nrl
SET effective_to = now()
FROM ranked
WHERE ranked.id = nrl.id
  AND ranked.rn > 1;

\echo '--- AFTER: cost-line active-row check (to_close should be 0) ---'
WITH base AS (
  SELECT ncl.project_id, p.project_name,
         CASE
           WHEN ncl.invoice_number IS NOT NULL AND trim(ncl.invoice_number) <> ''
             THEN 'INV:' || lower(trim(ncl.invoice_number))
           ELSE 'FB:'
                || COALESCE(lower(trim(ncl.sub_project_name)), '')                     || '|'
                || COALESCE(lower(trim(ncl.cost_category)), '')                        || '|'
                || COALESCE(lower(trim(ncl.counterparty_name)), '')                    || '|'
                || COALESCE(lower(trim(ncl.description)), '')                          || '|'
                || COALESCE(to_char(ncl.amount_ex_vat, 'FM999999999999990.00'), '')    || '|'
                || COALESCE(to_char(ncl.invoice_date, 'YYYY-MM-DD'), '')
         END AS bk
  FROM normalized_cost_lines ncl
  JOIN project_info p ON p.id = ncl.project_id
  WHERE ncl.effective_to IS NULL
    AND ncl.deleted_at IS NULL
)
SELECT project_name, COUNT(*) AS active_rows, COUNT(DISTINCT bk) AS distinct_keys,
       (COUNT(*) - COUNT(DISTINCT bk)) AS to_close
FROM base
GROUP BY project_name
HAVING COUNT(*) > COUNT(DISTINCT bk)
ORDER BY (COUNT(*) - COUNT(DISTINCT bk)) DESC
LIMIT 20;

COMMIT;
