-- Align work_items.external_ref uniqueness with the Drizzle schema
-- (shared/schema/tasks.ts → uqWorkItemsExternalRefActive) and with the
-- baseline migration 0000_baseline_20260419.sql, both of which declare a
-- PARTIAL unique index that only enforces uniqueness while a row is live
-- (deleted_at IS NULL). The runtime DB drifted to an unconditional UNIQUE
-- constraint (work_items_external_ref_key), which silently breaks every
-- Smart Import re-import after a bulk soft-delete: the writer cannot insert
-- a new row carrying the same external_ref as a previously soft-deleted
-- row, every PLAN insert fails with SQLSTATE 23505, savepoints roll back,
-- and the project ends up with missing WBS rows (observed on Mondi after
-- the 2026-05-15 bulk soft-delete).
--
-- Safe migration plan:
--   1. Drop the unconditional unique constraint IF EXISTS.
--   2. Drop the matching unconditional unique index IF EXISTS
--      (Postgres auto-creates an index of the same name with the
--      constraint; the DROP CONSTRAINT above removes both, but the
--      explicit DROP INDEX guards against installations where the index
--      survived a manual constraint drop.)
--   3. Create the partial unique index IF NOT EXISTS, matching the
--      Drizzle schema exactly.
--
-- Rollback note: this migration is NOT trivially reversible. Once it has
-- run, the table may legally contain multiple soft-deleted rows that share
-- an external_ref with a live row; recreating the unconditional unique
-- constraint would fail until those rows are reconciled (hard-deleted or
-- given distinct refs). If a rollback is ever required, write an explicit
-- down script with the necessary data reconciliation first.

ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_external_ref_key";--> statement-breakpoint

DROP INDEX IF EXISTS "work_items_external_ref_key";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_work_items_external_ref_active"
  ON "work_items" USING btree ("external_ref")
  WHERE "work_items"."deleted_at" IS NULL;--> statement-breakpoint
