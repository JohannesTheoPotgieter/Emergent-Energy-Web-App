-- =============================================================================
-- Rollback: Restore financial amount columns from NUMERIC back to TEXT
-- Date: 2026-03-30
--
-- Restores the original TEXT columns as canonical names.
-- Keeps the numeric columns as *_decimal for reference.
-- Keeps the audit table (migration_unparseable_amounts) intact.
-- =============================================================================

-- Rename canonical numeric columns back to *_decimal
ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_decimal;
ALTER TABLE normalized_revenue_lines RENAME COLUMN vat TO vat_decimal;
ALTER TABLE normalized_cost_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_decimal;

-- Rename *_legacy text columns back to canonical names
ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat_legacy TO amount_ex_vat;
ALTER TABLE normalized_revenue_lines RENAME COLUMN vat_legacy TO vat;
ALTER TABLE normalized_cost_lines RENAME COLUMN amount_ex_vat_legacy TO amount_ex_vat;

-- Note: migration_unparseable_amounts table is intentionally preserved.
-- Note: _parse_monetary function is intentionally preserved.
-- Both can be cleaned up in a separate PR after investigation.
