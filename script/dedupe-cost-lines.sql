-- ============================================================================
-- script/dedupe-cost-lines.sql
-- ----------------------------------------------------------------------------
-- One-shot cleanup for duplicate rows in `normalized_cost_lines`.
--
-- Background
-- ----------
-- The Excel tracker importer creates one normalized_cost_lines row per
-- "Expenditure Breakdown" row in the workbook. When a single invoice has
-- a multi-month payment plan, the tracker repeats the invoice on each
-- forecast paid_date row. The importer wrote each repeat as a separate
-- cost line, so e.g. Coega Steels Ph2 / Matriarch INV-6572 / R 82,141 became
-- 12 cost lines (R 985k of phantom cost) and Upper East Side Hotel /
-- FMS Property INV21346 became 6 cost lines (R 3.0M of phantom cost). Total
-- inflation in the snapshot at the time this script was authored was
-- R 40.7M across 1,424 extra rows in 455 duplicate groups.
--
-- What this script does
-- ---------------------
-- For every (project_name, invoice_number, invoice_date, amount_ex_vat)
-- group that has more than one live row (effective_to IS NULL AND
-- deleted_at IS NULL), keep the row with the smallest id and soft-delete
-- the rest by setting deleted_at = now() and recording an audit reason
-- in admin_date_override_reason.
--
-- Safety
-- ------
--  * Only operates on rows where invoice_number is non-empty (lines without
--    an invoice number cannot be safely deduplicated).
--  * Soft-delete only — no rows are physically removed; rerunning is a no-op.
--  * Wrapped in a transaction so a failed run leaves no partial state.
--  * Prints a count of rows soft-deleted and inflation removed before commit.
--
-- How to run
-- ----------
--   psql "$DATABASE_URL" -f script/dedupe-cost-lines.sql
--
-- Production
-- ----------
-- Production database is read-only to the application. A finance admin must
-- run this script manually against the production DATABASE_URL once they
-- are ready to apply the cleanup.
-- ============================================================================

BEGIN;

-- ---- Pre-flight diagnostics (logged to client) ----
\echo '--- BEFORE: duplicate group summary ---'
WITH dup_groups AS (
  SELECT project_name, invoice_number, invoice_date, amount_ex_vat,
         COUNT(*) AS copies,
         (COUNT(*) - 1) * MIN(amount_ex_vat::numeric) AS inflation
  FROM normalized_cost_lines
  WHERE effective_to IS NULL
    AND deleted_at IS NULL
    AND COALESCE(NULLIF(project_name, ''), '') <> ''
    AND invoice_number IS NOT NULL AND trim(invoice_number) <> ''
    AND invoice_date IS NOT NULL AND invoice_date <> ''
    AND amount_ex_vat IS NOT NULL
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)                 AS duplicate_groups,
  SUM(copies - 1)          AS rows_to_soft_delete,
  ROUND(SUM(inflation), 0) AS inflation_zar
FROM dup_groups;

-- ---- The cleanup itself ----
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_name, invoice_number, invoice_date, amount_ex_vat
           ORDER BY id
         ) AS rn
  FROM normalized_cost_lines
  WHERE effective_to IS NULL
    AND deleted_at IS NULL
    AND COALESCE(NULLIF(project_name, ''), '') <> ''
    AND invoice_number IS NOT NULL AND trim(invoice_number) <> ''
    AND invoice_date IS NOT NULL AND invoice_date <> ''
    AND amount_ex_vat IS NOT NULL
)
UPDATE normalized_cost_lines AS ncl
SET deleted_at = now(),
    admin_date_override_reason = COALESCE(
      ncl.admin_date_override_reason,
      'auto-dedup 2026-04-17: duplicate of earlier cost line by (project, invoice_number, invoice_date, amount)'
    )
FROM ranked
WHERE ranked.id = ncl.id
  AND ranked.rn > 1;

\echo '--- AFTER: residual duplicate groups (should be zero) ---'
WITH dup_groups AS (
  SELECT project_name, invoice_number, invoice_date, amount_ex_vat,
         COUNT(*) AS copies
  FROM normalized_cost_lines
  WHERE effective_to IS NULL
    AND deleted_at IS NULL
    AND COALESCE(NULLIF(project_name, ''), '') <> ''
    AND invoice_number IS NOT NULL AND trim(invoice_number) <> ''
    AND invoice_date IS NOT NULL AND invoice_date <> ''
    AND amount_ex_vat IS NOT NULL
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS remaining_duplicate_groups FROM dup_groups;

\echo '--- Sample of soft-deleted rows ---'
SELECT id, project_name, invoice_number, invoice_date,
       ROUND(amount_ex_vat::numeric, 0) AS amount_zar,
       deleted_at
FROM normalized_cost_lines
WHERE deleted_at IS NOT NULL
  AND admin_date_override_reason LIKE 'auto-dedup 2026-04-17%'
ORDER BY id DESC
LIMIT 10;

COMMIT;
