-- B5 (audit closeout) — COS period locks
--
-- Per direction from the breakdown discussion:
--   "B5. Please fix this"
-- referring to:
--   "Your COS SOP says: PMs update every Friday, PFM reviews Monday,
--    month-end locks on the 3rd working day of the next month. The system
--    has no 'lock' concept. A PM can retroactively change a cost for March
--    in May, and no one knows."
--
-- Follow-up directions:
--   - Business days = weekends + South African public holidays skipped.
--   - Auto-lock: scheduled daily job; when today is the 3rd business day
--     of the month, lock the previous month.
--   - Unlock: POST endpoint gated to COO + CFO only (PFM cannot unlock).
--   - Write path: a cost-line edit against a locked period returns 423
--     Locked unless the caller is COO / CFO / CEO, in which case the
--     override is logged to the audit trail.
--
-- Companion schema: shared/schema/finance.ts -> cosPeriodLocks
-- Rollback: 20260412_cos_period_locks_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS cos_period_locks (
  id                     serial PRIMARY KEY,
  period_month           date NOT NULL,
  locked_at              timestamptz NOT NULL DEFAULT now(),
  locked_by_user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  auto_locked            boolean NOT NULL DEFAULT false,
  unlocked_at            timestamptz,
  unlocked_by_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  unlock_reason          text,
  notes                  text,

  CONSTRAINT chk_cos_period_locks_month_is_first_of_month
    CHECK (EXTRACT(DAY FROM period_month) = 1),
  CONSTRAINT chk_cos_period_locks_unlock_consistency
    CHECK (
      (unlocked_at IS NULL AND unlocked_by_user_id IS NULL AND unlock_reason IS NULL)
      OR
      (unlocked_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_cos_period_locks_period
  ON cos_period_locks(period_month);

-- Partial index for the hot "is this period currently locked?" query.
-- Only active (non-unlocked) rows are indexed.
CREATE INDEX IF NOT EXISTS idx_cos_period_locks_active
  ON cos_period_locks(period_month)
  WHERE unlocked_at IS NULL;

COMMENT ON TABLE cos_period_locks IS
  'B5: COS month-end lock history. Active when unlocked_at IS NULL.';
COMMENT ON COLUMN cos_period_locks.period_month IS
  'First day of the month being locked (2026-03-01 = March 2026).';
COMMENT ON COLUMN cos_period_locks.auto_locked IS
  'TRUE if the lock was created by the scheduled auto-lock job on the 3rd business day of the following month, FALSE if a user manually invoked POST /api/cos-periods/:yyyy-mm/lock.';
COMMENT ON COLUMN cos_period_locks.unlocked_at IS
  'When the lock was released. NULL means the lock is still active. The row is NEVER deleted on unlock — the audit trail survives re-lock cycles.';

COMMIT;
