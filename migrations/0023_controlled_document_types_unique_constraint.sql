-- =========================================================================
-- Catch-up migration for the controlled-document FK fix.
--
-- Background:
--   migrations/0012_controlled_documents.sql originally created only a
--   UNIQUE INDEX on controlled_document_types.type_key, then added the
--   foreign key controlled_documents.controlled_documents_type_fk pointing
--   at that column. PostgreSQL strictly requires the referenced column to
--   be backed by a non-deferrable UNIQUE CONSTRAINT (or PRIMARY KEY) — a
--   plain unique index is NOT sufficient — and a fresh production deploy
--   failed with:
--
--     "there is no unique constraint matching given keys for referenced
--      table controlled_document_types"
--
--   0012 has been amended to add the constraint up-front, but environments
--   where 0012 already ran (dev) won't re-execute it. This migration is the
--   idempotent catch-up that brings those environments in line with the
--   amended 0012.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

DO $$ BEGIN
  ALTER TABLE "controlled_document_types"
    ADD CONSTRAINT "controlled_document_types_type_key_unique" UNIQUE ("type_key");
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN duplicate_table THEN null;
  WHEN unique_violation THEN
    RAISE NOTICE 'controlled_document_types.type_key has duplicate values; cannot add UNIQUE — investigate before retrying.';
END $$;
