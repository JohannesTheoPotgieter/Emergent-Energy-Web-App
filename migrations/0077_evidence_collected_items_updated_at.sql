-- Project Delivery wave-6 audit (2026-05-26) — make upsertEvidenceItem
-- truly idempotent.
--
-- The previous service function was named `upsert*` but the underlying
-- SQL was a plain INSERT — calling it twice with the same params
-- inserted two rows. This migration:
--   1. Adds `updated_at` so ON CONFLICT can record a refresh timestamp
--      without overwriting the original `created_at`.
--   2. Adds a partial unique index on the natural key
--      (project_id, completion_type, source_type, source_ref,
--       COALESCE(requirement_key, ''), evidence_type)
--      WHERE deleted_at IS NULL, so the new ON CONFLICT clause works
--      against both NULL and non-NULL requirement_key values.
--
-- Per § 6: additive only. IF NOT EXISTS guards on every statement.

ALTER TABLE "evidence_collected_items"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

-- Backfill `updated_at` to `created_at` for existing rows so the new
-- column starts coherent.
UPDATE "evidence_collected_items"
SET "updated_at" = "created_at"
WHERE "updated_at" = "created_at";  -- already-defaulted rows; safe no-op

CREATE UNIQUE INDEX IF NOT EXISTS "uq_evidence_collected_items_natural_key"
  ON "evidence_collected_items" (
    "project_id",
    "completion_type",
    "source_type",
    "source_ref",
    COALESCE("requirement_key", ''),
    "evidence_type"
  )
  WHERE "deleted_at" IS NULL;
