-- Migration 0072 — review cadence per priority
--
-- A priority can opt in to a recurring review cadence (e.g. "review
-- this weekly" = 7 days). The system tracks the last time someone
-- explicitly clicked "Mark reviewed" and surfaces "due for review"
-- badges when (last_reviewed_at ?? created_at) + cadence_days < now.
--
-- No cron required — the badge is computed at read time. POST
-- /api/priorities/:id/review updates last_reviewed_at.

ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS review_cadence_days INTEGER;

ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP;

ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS last_reviewed_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
