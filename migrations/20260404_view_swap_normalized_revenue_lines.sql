-- View-swap: public.normalized_revenue_lines → finance.revenue_lines
--
-- Converts the legacy normalized_revenue_lines table into a view backed by
-- finance.revenue_lines. All existing INSERT/UPDATE/DELETE statements continue
-- to work transparently via INSTEAD OF triggers.
--
-- Derived columns handled in PL/pgSQL triggers:
--   - invoice_date_typed: parsed from invoice_date TEXT → DATE
--   - expected_payment_date_typed: parsed from expected_payment_date TEXT → DATE
--   - paid_date_typed: parsed from paid_date TEXT → DATE
--   - fiscal_period_id: looked up from finance.fiscal_periods via invoice_date_typed
--   - project_id: resolved from project_name via core.projects (for promoted table)
--
-- Legacy-only columns added to promoted table:
--   - admin_date_override, admin_date_override_reason, admin_date_override_by, admin_date_override_at
--   - amount_ex_vat_legacy, vat_legacy
--
-- Rollback: see 20260404_view_swap_normalized_revenue_lines_rollback.sql

BEGIN;

-- ============================================================================
-- 1. Add legacy-only columns to finance.revenue_lines
-- ============================================================================

ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS amount_ex_vat_legacy TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS vat_legacy TEXT;

-- ============================================================================
-- 2. Backfill new columns from legacy data
-- ============================================================================

UPDATE finance.revenue_lines rl SET
  admin_date_override = nrl.admin_date_override,
  admin_date_override_reason = nrl.admin_date_override_reason,
  admin_date_override_by = nrl.admin_date_override_by,
  admin_date_override_at = nrl.admin_date_override_at,
  amount_ex_vat_legacy = nrl.amount_ex_vat_legacy,
  vat_legacy = nrl.vat_legacy
FROM public.normalized_revenue_lines nrl
WHERE rl.legacy_normalized_revenue_line_id = nrl.id
  AND (rl.admin_date_override IS DISTINCT FROM nrl.admin_date_override
    OR rl.amount_ex_vat_legacy IS DISTINCT FROM nrl.amount_ex_vat_legacy
    OR rl.vat_legacy IS DISTINCT FROM nrl.vat_legacy);

-- ============================================================================
-- 3. Rename legacy table
-- ============================================================================

ALTER TABLE public.normalized_revenue_lines RENAME TO _normalized_revenue_lines_legacy;

-- ============================================================================
-- 4. Create view with legacy column names
-- ============================================================================

CREATE OR REPLACE VIEW public.normalized_revenue_lines AS
SELECT
  rl.legacy_normalized_revenue_line_id AS id,
  COALESCE(rl.project_id, 0) AS project_id,
  COALESCE(rl.project_name_snapshot, '') AS project_name,
  rl.description,
  rl.milestone_name,
  rl.amount_ex_vat,
  rl.vat,
  rl.amount_ex_vat_legacy,
  rl.vat_legacy,
  rl.invoice_number,
  rl.invoice_date,
  rl.invoice_date_font_color,
  rl.invoice_date_confirmed,
  rl.expected_payment_date,
  rl.paid_date,
  rl.paid_date_font_color,
  rl.paid_date_confirmed,
  rl.in_bank_date,
  rl.status,
  rl.source_sheet,
  rl.source_row,
  rl.import_run_id,
  rl.turnaround_days,
  rl.admin_date_override,
  rl.admin_date_override_reason,
  rl.admin_date_override_by,
  rl.admin_date_override_at,
  rl.sub_project_name,
  rl.created_at,
  rl.updated_at,
  rl.effective_from,
  rl.effective_to,
  rl.snapshot_run_id
FROM finance.revenue_lines rl
WHERE rl.legacy_normalized_revenue_line_id IS NOT NULL;

-- ============================================================================
-- 5. INSTEAD OF triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public._nrl_view_insert() RETURNS trigger AS $$
DECLARE
  _invoice_date_typed DATE;
  _expected_date_typed DATE;
  _paid_date_typed DATE;
  _fiscal_period_id INTEGER;
  _resolved_project_id INTEGER;
BEGIN
  -- Derive typed dates (uses shared helper from cost_lines migration)
  _invoice_date_typed := public._safe_parse_date(NEW.invoice_date);
  _expected_date_typed := public._safe_parse_date(NEW.expected_payment_date);
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

  INSERT INTO finance.revenue_lines (
    legacy_normalized_revenue_line_id, project_id, project_name_snapshot,
    description, milestone_name, amount_ex_vat, vat,
    amount_ex_vat_legacy, vat_legacy,
    invoice_number, invoice_date, invoice_date_typed,
    invoice_date_font_color, invoice_date_confirmed,
    expected_payment_date, expected_payment_date_typed,
    paid_date, paid_date_typed,
    paid_date_font_color, paid_date_confirmed,
    in_bank_date, status,
    source_sheet, source_row, import_run_id, turnaround_days,
    admin_date_override, admin_date_override_reason,
    admin_date_override_by, admin_date_override_at,
    sub_project_name,
    fiscal_period_id,
    effective_from, effective_to, snapshot_run_id,
    last_synced_at, source_table, created_at, updated_at
  ) VALUES (
    NEW.id, _resolved_project_id, NEW.project_name,
    NEW.description, NEW.milestone_name, NEW.amount_ex_vat, NEW.vat,
    NEW.amount_ex_vat_legacy, NEW.vat_legacy,
    NEW.invoice_number, NEW.invoice_date, _invoice_date_typed,
    NEW.invoice_date_font_color, NEW.invoice_date_confirmed,
    NEW.expected_payment_date, _expected_date_typed,
    NEW.paid_date, _paid_date_typed,
    NEW.paid_date_font_color, NEW.paid_date_confirmed,
    NEW.in_bank_date, NEW.status,
    NEW.source_sheet, NEW.source_row, NEW.import_run_id, NEW.turnaround_days,
    NEW.admin_date_override, NEW.admin_date_override_reason,
    NEW.admin_date_override_by, NEW.admin_date_override_at,
    NEW.sub_project_name,
    _fiscal_period_id,
    COALESCE(NEW.effective_from, NOW()), NEW.effective_to, NEW.snapshot_run_id,
    NOW(), 'public.normalized_revenue_lines', COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
  )
  ON CONFLICT (legacy_normalized_revenue_line_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    project_name_snapshot = EXCLUDED.project_name_snapshot,
    description = EXCLUDED.description,
    milestone_name = EXCLUDED.milestone_name,
    amount_ex_vat = EXCLUDED.amount_ex_vat,
    vat = EXCLUDED.vat,
    invoice_number = EXCLUDED.invoice_number,
    invoice_date = EXCLUDED.invoice_date,
    invoice_date_typed = EXCLUDED.invoice_date_typed,
    expected_payment_date = EXCLUDED.expected_payment_date,
    expected_payment_date_typed = EXCLUDED.expected_payment_date_typed,
    paid_date = EXCLUDED.paid_date,
    paid_date_typed = EXCLUDED.paid_date_typed,
    status = EXCLUDED.status,
    fiscal_period_id = EXCLUDED.fiscal_period_id,
    effective_to = EXCLUDED.effective_to,
    last_synced_at = NOW(),
    updated_at = NOW();

  -- Also maintain legacy table for rollback safety
  INSERT INTO public._normalized_revenue_lines_legacy VALUES (NEW.*)
  ON CONFLICT (id) DO UPDATE SET
    project_name = EXCLUDED.project_name,
    milestone_name = EXCLUDED.milestone_name,
    description = EXCLUDED.description,
    amount_ex_vat = EXCLUDED.amount_ex_vat,
    invoice_number = EXCLUDED.invoice_number,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._nrl_view_update() RETURNS trigger AS $$
DECLARE
  _invoice_date_typed DATE;
  _expected_date_typed DATE;
  _paid_date_typed DATE;
  _fiscal_period_id INTEGER;
BEGIN
  -- Derive typed dates
  _invoice_date_typed := public._safe_parse_date(NEW.invoice_date);
  _expected_date_typed := public._safe_parse_date(NEW.expected_payment_date);
  _paid_date_typed := public._safe_parse_date(NEW.paid_date);

  -- Resolve fiscal_period_id
  IF _invoice_date_typed IS NOT NULL THEN
    SELECT id INTO _fiscal_period_id
    FROM finance.fiscal_periods
    WHERE _invoice_date_typed BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;

  UPDATE finance.revenue_lines SET
    project_name_snapshot = NEW.project_name,
    description = NEW.description,
    milestone_name = NEW.milestone_name,
    amount_ex_vat = NEW.amount_ex_vat,
    vat = NEW.vat,
    amount_ex_vat_legacy = NEW.amount_ex_vat_legacy,
    vat_legacy = NEW.vat_legacy,
    invoice_number = NEW.invoice_number,
    invoice_date = NEW.invoice_date,
    invoice_date_typed = _invoice_date_typed,
    invoice_date_font_color = NEW.invoice_date_font_color,
    invoice_date_confirmed = NEW.invoice_date_confirmed,
    expected_payment_date = NEW.expected_payment_date,
    expected_payment_date_typed = _expected_date_typed,
    paid_date = NEW.paid_date,
    paid_date_typed = _paid_date_typed,
    paid_date_font_color = NEW.paid_date_font_color,
    paid_date_confirmed = NEW.paid_date_confirmed,
    in_bank_date = NEW.in_bank_date,
    status = NEW.status,
    turnaround_days = NEW.turnaround_days,
    admin_date_override = NEW.admin_date_override,
    admin_date_override_reason = NEW.admin_date_override_reason,
    admin_date_override_by = NEW.admin_date_override_by,
    admin_date_override_at = NEW.admin_date_override_at,
    sub_project_name = NEW.sub_project_name,
    fiscal_period_id = _fiscal_period_id,
    effective_to = NEW.effective_to,
    last_synced_at = NOW(),
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE legacy_normalized_revenue_line_id = NEW.id;

  -- Also update legacy table
  UPDATE public._normalized_revenue_lines_legacy SET
    project_name = NEW.project_name,
    description = NEW.description,
    milestone_name = NEW.milestone_name,
    amount_ex_vat = NEW.amount_ex_vat,
    invoice_number = NEW.invoice_number,
    invoice_date = NEW.invoice_date,
    expected_payment_date = NEW.expected_payment_date,
    paid_date = NEW.paid_date,
    status = NEW.status,
    effective_to = NEW.effective_to,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._nrl_view_delete() RETURNS trigger AS $$
BEGIN
  -- Soft-close in promoted schema (set effective_to)
  UPDATE finance.revenue_lines
  SET effective_to = NOW(), updated_at = NOW()
  WHERE legacy_normalized_revenue_line_id = OLD.id;
  -- Hard-delete from legacy table
  DELETE FROM public._normalized_revenue_lines_legacy WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nrl_view_insert INSTEAD OF INSERT ON public.normalized_revenue_lines
  FOR EACH ROW EXECUTE FUNCTION public._nrl_view_insert();
CREATE TRIGGER nrl_view_update INSTEAD OF UPDATE ON public.normalized_revenue_lines
  FOR EACH ROW EXECUTE FUNCTION public._nrl_view_update();
CREATE TRIGGER nrl_view_delete INSTEAD OF DELETE ON public.normalized_revenue_lines
  FOR EACH ROW EXECUTE FUNCTION public._nrl_view_delete();

COMMIT;
