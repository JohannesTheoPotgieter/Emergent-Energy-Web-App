-- Migration: 20260403_g01_create_external_resources.sql
-- Phase G.1: Create core.external_resources + core.resource_links.
-- Unifies sp_files, deliverable_files, sp_file_pointers, and scattered
-- SharePoint columns into a single resource model with flexible entity linking.
-- Files live on SharePoint via OneDrive; a single resource can link to multiple entities.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.external_resources — unified file/resource registry
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.external_resources (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_resource_id    INTEGER,
  legacy_resource_table TEXT NOT NULL,
  resource_type         TEXT NOT NULL DEFAULT 'file',
  file_name             TEXT,
  web_url               TEXT,
  site_id               TEXT,
  drive_id              TEXT,
  item_id               TEXT,
  mime_type             TEXT,
  file_size             INTEGER,
  etag                  TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_party_id  BIGINT REFERENCES core.parties(id),
  uploaded_at           TIMESTAMP,
  resource_data         JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_resource_table, legacy_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_external_resources_site_drive_item
  ON core.external_resources (site_id, drive_id, item_id);

CREATE INDEX IF NOT EXISTS idx_external_resources_resource_type
  ON core.external_resources (resource_type);

CREATE INDEX IF NOT EXISTS idx_external_resources_uploaded_by
  ON core.external_resources (uploaded_by_party_id);

COMMENT ON TABLE core.external_resources IS
  'Phase G.1: Unified file/resource registry. Consolidates sp_files, deliverable_files, and sp_file_pointers. All files live on SharePoint via OneDrive. Linked to entities via core.resource_links.';

-- -------------------------------------------------------
-- 2. core.resource_links — many-to-many entity junction
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.resource_links (
  id                    BIGSERIAL PRIMARY KEY,
  external_resource_id  BIGINT NOT NULL REFERENCES core.external_resources(id),
  entity_type           TEXT NOT NULL,
  entity_id             BIGINT NOT NULL,
  link_type             TEXT NOT NULL DEFAULT 'attachment',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (external_resource_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_links_resource_id
  ON core.resource_links (external_resource_id);

CREATE INDEX IF NOT EXISTS idx_resource_links_entity
  ON core.resource_links (entity_type, entity_id);

COMMENT ON TABLE core.resource_links IS
  'Phase G.1: Many-to-many junction between external_resources and any entity. A single file can be linked to multiple deliverables, work items, projects, etc.';

COMMIT;
