-- Migration 0069 — soft-delete (archive) for priorities
--
-- Adds a `deleted_at` column to mytool_company_priorities so admins can
-- archive priorities without hard-deleting (and lose audit history /
-- child links). All read endpoints filter `deleted_at IS NULL` by
-- default; admins may opt in via `?include_archived=true`.
--
-- Restore is a separate operation (POST /api/priorities/:id/restore)
-- that clears `deleted_at`.
--
-- Index supports the partial-null lookup pattern used by every list
-- query.

ALTER TABLE mytool_company_priorities
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_priorities_deleted_at
  ON mytool_company_priorities (deleted_at)
  WHERE deleted_at IS NULL;
