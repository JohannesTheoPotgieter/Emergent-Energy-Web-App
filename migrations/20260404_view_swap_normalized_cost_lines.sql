-- View-swap: public.normalized_cost_lines → finance.cost_lines
--
-- Converts the legacy normalized_cost_lines table into a view backed by
-- finance.cost_lines. All existing INSERT/UPDATE/DELETE statements continue
-- to work transparently via INSTEAD OF triggers.
--
-- Derived columns handled in PL/pgSQL triggers:
--   - invoice_date_typed: parsed from invoice_date TEXT → DATE
--   - approved_date_typed: parsed from approved_date TEXT → DATE
--   - paid_date_typed: parsed from paid_date TEXT → DATE
--   - fiscal_period_id: looked up from finance.fiscal_periods via invoice_date_typed
--   - project_id: resolved from project_name via core.projects (for promoted table)
--
-- Legacy-only columns added to promoted table:
--   - pattern_rule_id, pattern_classified_at, pattern_inferred_type
--   - admin_date_override, admin_date_override_reason, admin_date_override_by, admin_date_override_at
--   - amount_ex_vat_legacy
--
-- Rollback: see 20260404_view_swap_normalized_cost_lines_rollback.sql

BEGIN;

-- ============================================================================
-- 1. Helper: safe date parser (reusable across cost + revenue triggers)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._safe_parse_date(val TEXT) RETURNS DATE AS $$
BEGIN
  IF val IS NULL OR TRIM(val) = '' THEN RETURN NULL; END IF;
  IF val !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN SUBSTRING(val FROM 1 FOR 10)::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 2. Add legacy-only columns to finance.cost_lines
-- ============================================================================

ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_rule_id INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_classified_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_inferred_type TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS amount_ex_vat_legacy TEXT;

-- ============================================================================
-- 3. Backfill new columns from legacy data
-- ============================================================================

UPDATE finance.cost_lines cl SET
  pattern_rule_id = ncl.pattern_rule_id,
  pattern_classified_at = ncl.pattern_classified_at,
  pattern_inferred_type = ncl.pattern_inferred_type,
  admin_date_override = ncl.admin_date_override,
  admin_date_override_reason = ncl.admin_date_override_reason,
  admin_date_override_by = ncl.admin_date_override_by,
  admin_date_override_at = ncl.admin_date_override_at,
  amount_ex_vat_legacy = ncl.amount_ex_vat_legacy
FROM public.normalized_cost_lines ncl
WHERE cl.legacy_normalized_cost_line_id = ncl.id
  AND (cl.pattern_rule_id IS DISTINCT FROM ncl.pattern_rule_id
    OR cl.admin_date_override IS DISTINCT FROM ncl.admin_date_override
    OR cl.amount_ex_vat_legacy IS DISTINCT FROM ncl.amount_ex_vat_legacy);

-- ============================================================================
-- 4. Rename legacy table
-- ============================================================================

ALTER TABLE public.normalized_cost_lines RENAME TO _normalized_cost_lines_legacy;

-- ============================================================================
-- 5. Create view with legacy column names
-- ============================================================================

CREATE OR REPLACE VIEW public.normalized_cost_lines AS
SELECT
  cl.legacy_normalized_cost_line_id AS id,
  COALESCE(cl.project_id, 0) AS project_id,
  COALESCE(cl.project_name_snapshot, '') AS project_name,
  cl.cost_category,
  cl.counterparty_id,
  cl.counterparty_name,
  cl.counterparty_type,
  cl.description,
  cl.amount_ex_vat,
  cl.amount_ex_vat_legacy,
  cl.invoice_number,
  cl.invoice_date,
  cl.invoice_date_font_color,
  cl.invoice_date_confirmed,
  cl.approved_date,
  cl.paid_date,
  cl.paid_date_font_color,
  cl.paid_date_confirmed,
  cl.po_number,
  cl.cos_realised,
  cl.cashflow_confirmed,
  cl.cost_line_status,
  cl.source_sheet,
  cl.source_row,
  cl.import_run_id,
  cl.turnaround_days,
  cl.pattern_rule_id,
  cl.pattern_classified_at,
  cl.pattern_inferred_type,
  cl.no_revenue_linked,
  cl.budget_qty,
  cl.budget_rate,
  cl.budget_total,
  cl.budget_cos,
  cl.revenue_recognition_amount,
  cl.forecast_payment_date,
  cl.admin_date_override,
  cl.admin_date_override_reason,
  cl.admin_date_override_by,
  cl.admin_date_override_at,
  cl.sub_project_name,
  cl.cos_status_override,
  cl.cos_status_override_by,
  cl.cos_status_override_at,
  cl.cos_status_override_reason,
  cl.created_at,
  cl.updated_at,
  cl.effective_from,
  cl.effective_to,
  cl.snapshot_run_id
FROM finance.cost_lines cl
WHERE cl.legacy_normalized_cost_line_id IS NOT NULL;

-- ============================================================================
-- 6. INSTEAD OF triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public._ncl_view_insert() RETURNS trigger AS $$
DECLARE
  _invoice_date_typed DATE;
  _approved_date_typed DATE;
  _paid_date_typed DATE;
  _fiscal_period_id INTEGER;
  _resolved_project_id INTEGER;
BEGIN
  -- Derive typed dates
  _invoice_date_typed := public._safe_parse_date(NEW.invoice_date);
  _approved_date_typed := public._safe_parse_date(NEW.approved_date);
  _paid_date_typed := public._safe_parse_date(NEW.paid_date);

  -- Resolve fiscal_period_id from invoice_date
  IF _invoice_date_typed IS NOT NULL THEN
    SELECT id INTO _fiscal_period_id
    FROM finance.fiscal_periods
    WHERE _invoice_date_typed BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;

  -- Resolve project_id from project_name for promoted table
  _resolved_project_id := NEW.project_id;
  IF _resolved_project_id IS NULL OR _resolved_project_id = 0 THEN
    SELECT id INTO _resolved_project_id
    FROM core.projects
    WHERE project_name = NEW.project_name
    LIMIT 1;
  END IF;

  INSERT INTO finance.cost_lines (
    legacy_normalized_cost_line_id, project_id, project_name_snapshot,
    cost_category, counterparty_id, counterparty_name, counterparty_type,
    description, amount_ex_vat, amount_ex_vat_legacy,
    invoice_number, invoice_date, invoice_date_typed,
    invoice_date_font_color, invoice_date_confirmed,
    approved_date, approved_date_typed,
    paid_date, paid_date_typed,
    paid_date_font_color, paid_date_confirmed,
    po_number, cos_realised, cashflow_confirmed,
    cost_line_status, status,
    source_sheet, source_row, import_run_id, turnaround_days,
    pattern_rule_id, pattern_classified_at, pattern_inferred_type,
    no_revenue_linked,
    budget_qty, budget_rate, budget_total, budget_cos,
    revenue_recognition_amount, forecast_payment_date,
    admin_date_override, admin_date_override_reason,
    admin_date_override_by, admin_date_override_at,
    sub_project_name,
    cos_status_override, cos_status_override_by,
    cos_status_override_at, cos_status_override_reason,
    fiscal_period_id,
    effective_from, effective_to, snapshot_run_id,
    last_synced_at, source_table, created_at, updated_at
  ) VALUES (
    NEW.id, _resolved_project_id, NEW.project_name,
    NEW.cost_category, NEW.counterparty_id, NEW.counterparty_name, NEW.counterparty_type,
    NEW.description, NEW.amount_ex_vat, NEW.amount_ex_vat_legacy,
    NEW.invoice_number, NEW.invoice_date, _invoice_date_typed,
    NEW.invoice_date_font_color, NEW.invoice_date_confirmed,
    NEW.approved_date, _approved_date_typed,
    NEW.paid_date, _paid_date_typed,
    NEW.paid_date_font_color, NEW.paid_date_confirmed,
    NEW.po_number, NEW.cos_realised, NEW.cashflow_confirmed,
    NEW.cost_line_status, NEW.cost_line_status,
    NEW.source_sheet, NEW.source_row, NEW.import_run_id, NEW.turnaround_days,
    NEW.pattern_rule_id, NEW.pattern_classified_at, NEW.pattern_inferred_type,
    NEW.no_revenue_linked,
    NEW.budget_qty, NEW.budget_rate, NEW.budget_total, NEW.budget_cos,
    NEW.revenue_recognition_amount, NEW.forecast_payment_date,
    NEW.admin_date_override, NEW.admin_date_override_reason,
    NEW.admin_date_override_by, NEW.admin_date_override_at,
    NEW.sub_project_name,
    NEW.cos_status_override, NEW.cos_status_override_by,
    NEW.cos_status_override_at, NEW.cos_status_override_reason,
    _fiscal_period_id,
    COALESCE(NEW.effective_from, NOW()), NEW.effective_to, NEW.snapshot_run_id,
    NOW(), 'public.normalized_cost_lines', COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
  )
  ON CONFLICT (legacy_normalized_cost_line_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    project_name_snapshot = EXCLUDED.project_name_snapshot,
    cost_category = EXCLUDED.cost_category,
    counterparty_id = EXCLUDED.counterparty_id,
    counterparty_name = EXCLUDED.counterparty_name,
    counterparty_type = EXCLUDED.counterparty_type,
    description = EXCLUDED.description,
    amount_ex_vat = EXCLUDED.amount_ex_vat,
    amount_ex_vat_legacy = EXCLUDED.amount_ex_vat_legacy,
    invoice_number = EXCLUDED.invoice_number,
    invoice_date = EXCLUDED.invoice_date,
    invoice_date_typed = EXCLUDED.invoice_date_typed,
    approved_date = EXCLUDED.approved_date,
    approved_date_typed = EXCLUDED.approved_date_typed,
    paid_date = EXCLUDED.paid_date,
    paid_date_typed = EXCLUDED.paid_date_typed,
    cost_line_status = EXCLUDED.cost_line_status,
    status = EXCLUDED.status,
    fiscal_period_id = EXCLUDED.fiscal_period_id,
    effective_to = EXCLUDED.effective_to,
    last_synced_at = NOW(),
    updated_at = NOW();

  -- Also maintain legacy table for rollback safety
  INSERT INTO public._normalized_cost_lines_legacy VALUES (NEW.*)
  ON CONFLICT (id) DO UPDATE SET
    project_name = EXCLUDED.project_name,
    counterparty_name = EXCLUDED.counterparty_name,
    description = EXCLUDED.description,
    amount_ex_vat = EXCLUDED.amount_ex_vat,
    invoice_number = EXCLUDED.invoice_number,
    cost_line_status = EXCLUDED.cost_line_status,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._ncl_view_update() RETURNS trigger AS $$
DECLARE
  _invoice_date_typed DATE;
  _approved_date_typed DATE;
  _paid_date_typed DATE;
  _fiscal_period_id INTEGER;
BEGIN
  -- Derive typed dates
  _invoice_date_typed := public._safe_parse_date(NEW.invoice_date);
  _approved_date_typed := public._safe_parse_date(NEW.approved_date);
  _paid_date_typed := public._safe_parse_date(NEW.paid_date);

  -- Resolve fiscal_period_id
  IF _invoice_date_typed IS NOT NULL THEN
    SELECT id INTO _fiscal_period_id
    FROM finance.fiscal_periods
    WHERE _invoice_date_typed BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;

  UPDATE finance.cost_lines SET
    project_name_snapshot = NEW.project_name,
    cost_category = NEW.cost_category,
    counterparty_id = NEW.counterparty_id,
    counterparty_name = NEW.counterparty_name,
    counterparty_type = NEW.counterparty_type,
    description = NEW.description,
    amount_ex_vat = NEW.amount_ex_vat,
    amount_ex_vat_legacy = NEW.amount_ex_vat_legacy,
    invoice_number = NEW.invoice_number,
    invoice_date = NEW.invoice_date,
    invoice_date_typed = _invoice_date_typed,
    invoice_date_font_color = NEW.invoice_date_font_color,
    invoice_date_confirmed = NEW.invoice_date_confirmed,
    approved_date = NEW.approved_date,
    approved_date_typed = _approved_date_typed,
    paid_date = NEW.paid_date,
    paid_date_typed = _paid_date_typed,
    paid_date_font_color = NEW.paid_date_font_color,
    paid_date_confirmed = NEW.paid_date_confirmed,
    po_number = NEW.po_number,
    cos_realised = NEW.cos_realised,
    cashflow_confirmed = NEW.cashflow_confirmed,
    cost_line_status = NEW.cost_line_status,
    status = NEW.cost_line_status,
    turnaround_days = NEW.turnaround_days,
    pattern_rule_id = NEW.pattern_rule_id,
    pattern_classified_at = NEW.pattern_classified_at,
    pattern_inferred_type = NEW.pattern_inferred_type,
    no_revenue_linked = NEW.no_revenue_linked,
    budget_qty = NEW.budget_qty,
    budget_rate = NEW.budget_rate,
    budget_total = NEW.budget_total,
    budget_cos = NEW.budget_cos,
    revenue_recognition_amount = NEW.revenue_recognition_amount,
    forecast_payment_date = NEW.forecast_payment_date,
    admin_date_override = NEW.admin_date_override,
    admin_date_override_reason = NEW.admin_date_override_reason,
    admin_date_override_by = NEW.admin_date_override_by,
    admin_date_override_at = NEW.admin_date_override_at,
    sub_project_name = NEW.sub_project_name,
    cos_status_override = NEW.cos_status_override,
    cos_status_override_by = NEW.cos_status_override_by,
    cos_status_override_at = NEW.cos_status_override_at,
    cos_status_override_reason = NEW.cos_status_override_reason,
    fiscal_period_id = _fiscal_period_id,
    effective_to = NEW.effective_to,
    last_synced_at = NOW(),
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE legacy_normalized_cost_line_id = NEW.id;

  -- Also update legacy table
  UPDATE public._normalized_cost_lines_legacy SET
    project_name = NEW.project_name,
    cost_category = NEW.cost_category,
    counterparty_name = NEW.counterparty_name,
    description = NEW.description,
    amount_ex_vat = NEW.amount_ex_vat,
    invoice_number = NEW.invoice_number,
    invoice_date = NEW.invoice_date,
    approved_date = NEW.approved_date,
    paid_date = NEW.paid_date,
    cost_line_status = NEW.cost_line_status,
    po_number = NEW.po_number,
    effective_to = NEW.effective_to,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._ncl_view_delete() RETURNS trigger AS $$
BEGIN
  -- Soft-close in promoted schema (set effective_to)
  UPDATE finance.cost_lines
  SET effective_to = NOW(), updated_at = NOW()
  WHERE legacy_normalized_cost_line_id = OLD.id;
  -- Hard-delete from legacy table
  DELETE FROM public._normalized_cost_lines_legacy WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ncl_view_insert INSTEAD OF INSERT ON public.normalized_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public._ncl_view_insert();
CREATE TRIGGER ncl_view_update INSTEAD OF UPDATE ON public.normalized_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public._ncl_view_update();
CREATE TRIGGER ncl_view_delete INSTEAD OF DELETE ON public.normalized_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public._ncl_view_delete();

COMMIT;
