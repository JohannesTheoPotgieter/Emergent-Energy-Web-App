-- Backfill: 20260403_a09_backfill_role_assignments.sql
-- Phase A.4: Populate core.role_assignments from public.users.role.
-- Resolves user_account via legacy_user_id, role_definition via code, department via role_definition.
-- Idempotent: uses NOT EXISTS guard to prevent duplicate assignments.
-- Must run AFTER: 20260403_a08_create_role_assignments.sql
BEGIN;

-- -------------------------------------------------------
-- Safety check: surface any users whose role code does NOT
-- match a row in core.role_definitions. These users will
-- NOT get a role_assignment row. This SELECT produces
-- output visible in migration logs so gaps are never silent.
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched
  FROM public.users u
  LEFT JOIN core.role_definitions rd ON rd.code = u.role
  WHERE rd.id IS NULL;

  IF _unmatched > 0 THEN
    RAISE WARNING '[Phase A.4 backfill] % user(s) have a role code not found in core.role_definitions and will NOT receive a role_assignment row. Run: SELECT u.id, u.name, u.role FROM public.users u LEFT JOIN core.role_definitions rd ON rd.code = u.role WHERE rd.id IS NULL;',
      _unmatched;
  END IF;
END $$;

-- -------------------------------------------------------
-- Backfill: one active role_assignment per user
-- -------------------------------------------------------
INSERT INTO core.role_assignments (user_account_id, role_definition_id, department_id, start_date)
SELECT
  ua.id,
  rd.id,
  rd.department_id,
  COALESCE(u.created_at::date, CURRENT_DATE)
FROM public.users u
JOIN core.user_accounts ua ON ua.legacy_user_id = u.id
JOIN core.role_definitions rd ON rd.code = u.role
WHERE NOT EXISTS (
  SELECT 1 FROM core.role_assignments ra
  WHERE ra.user_account_id = ua.id
    AND ra.role_definition_id = rd.id
    AND ra.end_date IS NULL
);

COMMIT;
