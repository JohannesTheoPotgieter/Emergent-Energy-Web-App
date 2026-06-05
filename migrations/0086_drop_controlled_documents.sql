-- 0086_drop_controlled_documents.sql
--
-- Destructive cleanup (owner-approved): removes the deprecated
-- controlled-documents subsystem now that the canonical
-- managed_documents + folder_taxonomy + project_folders surface fully
-- replaces it.
--
-- Dropped:
--   * controlled_documents           (per-project tracked files)
--   * controlled_document_types      (type taxonomy — replaced by
--                                     document_approval_requirements)
--   * project_sharepoint_roots       (per-project root — replaced by
--                                     project_folders / Active Clients taxonomy)
--   * controlled_document_state_enum (enum used only by controlled_documents)
--
-- Safe to drop: these tables carried no production data (D6 was rebuilt
-- before any controlled documents were filed) and no live code reads or
-- writes them after the controlled-documents removal. Any historical
-- `approvals` rows with related_entity_type='controlled_document' were
-- never backed by a DB-level FK, so they are left intact as audit history.
--
-- Hand-authored, idempotent (re-runnable): every DROP uses IF EXISTS.
-- Postgres-only migration — the SQLite dev path bootstraps tables in
-- server/db.ts and never created these.

BEGIN;

-- Child first: controlled_documents references controlled_document_types
-- (type_key) and uses controlled_document_state_enum.
DROP TABLE IF EXISTS "controlled_documents" CASCADE;

-- Type taxonomy (parent of controlled_documents).
DROP TABLE IF EXISTS "controlled_document_types" CASCADE;

-- Per-project SharePoint root, subsumed by project_folders.
DROP TABLE IF EXISTS "project_sharepoint_roots" CASCADE;

-- Enum used only by the now-dropped controlled_documents table.
DROP TYPE IF EXISTS "controlled_document_state_enum";

COMMIT;
