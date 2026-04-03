-- Backfill: 20260403_g02_backfill_external_resources.sql
-- Phase G.2: Populate core.external_resources from 3 source tables:
--   1. sp_files → tracked SharePoint files
--   2. deliverable_files → engineering deliverable attachments
--   3. sp_file_pointers → entity-linked SharePoint files
-- Then create resource_links for entity associations.
-- Idempotent: ON CONFLICT DO NOTHING.
-- Must run AFTER: 20260403_g01_create_external_resources.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_del_files  INTEGER;
  _unmatched_uploaders  INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_del_files
  FROM deliverable_files df
  WHERE NOT EXISTS (
    SELECT 1 FROM core.deliverable_instances di
    WHERE di.legacy_deliverable_table = 'deliverables'
      AND di.legacy_deliverable_id = df.deliverable_id
  );
  IF _unmatched_del_files > 0 THEN
    RAISE WARNING '[Phase G.2 backfill] % deliverable_file(s) reference deliverables not in deliverable_instances', _unmatched_del_files;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_uploaders
  FROM (
    SELECT df.uploaded_by_user_id AS user_id FROM deliverable_files df WHERE df.uploaded_by_user_id IS NOT NULL
    UNION ALL
    SELECT sfp.uploaded_by_user_id FROM sp_file_pointers sfp WHERE sfp.uploaded_by_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_uploaders > 0 THEN
    RAISE WARNING '[Phase G.2 backfill] % distinct user_id(s) not resolvable to user_accounts; uploaded_by_party_id will remain NULL', _unmatched_uploaders;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. sp_files → tracked SharePoint files
-- -------------------------------------------------------
INSERT INTO core.external_resources (
  legacy_resource_id, legacy_resource_table,
  resource_type, file_name, site_id, drive_id, item_id,
  etag, is_active, uploaded_at,
  resource_data, created_at, updated_at
)
SELECT
  sf.id,
  'sp_files',
  'sharepoint_file',
  sf.file_name,
  sf.site_id,
  sf.drive_id,
  sf.item_id,
  sf.last_seen_etag,
  COALESCE(sf.is_active, true),
  sf.sp_last_modified_at,
  jsonb_build_object(
    'path', sf.path,
    'last_seen_ctag', sf.last_seen_ctag,
    'sp_last_modified_by_name', sf.sp_last_modified_by_name,
    'sp_last_modified_by_email', sf.sp_last_modified_by_email
  ),
  sf.created_at,
  sf.updated_at
FROM sp_files sf
WHERE sf.deleted_at IS NULL
ON CONFLICT (legacy_resource_table, legacy_resource_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. deliverable_files → engineering deliverable attachments
-- -------------------------------------------------------
INSERT INTO core.external_resources (
  legacy_resource_id, legacy_resource_table,
  resource_type, file_name, web_url,
  site_id, drive_id, item_id,
  uploaded_at,
  resource_data, created_at
)
SELECT
  df.id,
  'deliverable_files',
  'deliverable_file',
  df.file_name,
  df.web_url,
  df.site_id,
  df.drive_id,
  df.file_item_id,
  df.uploaded_at,
  jsonb_build_object(
    'deliverable_id', df.deliverable_id,
    'version_id', df.version_id,
    'is_approved', df.is_approved
  ),
  COALESCE(df.uploaded_at, NOW())
FROM deliverable_files df
ON CONFLICT (legacy_resource_table, legacy_resource_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. sp_file_pointers → entity-linked SharePoint files
-- -------------------------------------------------------
INSERT INTO core.external_resources (
  legacy_resource_id, legacy_resource_table,
  resource_type, file_name, web_url,
  site_id, drive_id, item_id,
  uploaded_at,
  resource_data, created_at
)
SELECT
  sfp.id,
  'sp_file_pointers',
  'file_pointer',
  sfp.file_name,
  sfp.web_url,
  sfp.site_id,
  sfp.drive_id,
  sfp.file_item_id,
  sfp.uploaded_at,
  jsonb_build_object(
    'entity_type', sfp.entity_type,
    'entity_id', sfp.entity_id,
    'folder_item_id', sfp.folder_item_id
  ),
  sfp.uploaded_at
FROM sp_file_pointers sfp
ON CONFLICT (legacy_resource_table, legacy_resource_id) DO NOTHING;

-- -------------------------------------------------------
-- 4. Resolve uploaded_by_party_id
-- -------------------------------------------------------

-- deliverable_files
UPDATE core.external_resources er
SET uploaded_by_party_id = ua.party_id
FROM deliverable_files df
JOIN core.user_accounts ua ON ua.legacy_user_id = df.uploaded_by_user_id
WHERE er.legacy_resource_table = 'deliverable_files'
  AND er.legacy_resource_id = df.id
  AND df.uploaded_by_user_id IS NOT NULL
  AND er.uploaded_by_party_id IS NULL;

-- sp_file_pointers
UPDATE core.external_resources er
SET uploaded_by_party_id = ua.party_id
FROM sp_file_pointers sfp
JOIN core.user_accounts ua ON ua.legacy_user_id = sfp.uploaded_by_user_id
WHERE er.legacy_resource_table = 'sp_file_pointers'
  AND er.legacy_resource_id = sfp.id
  AND sfp.uploaded_by_user_id IS NOT NULL
  AND er.uploaded_by_party_id IS NULL;

-- -------------------------------------------------------
-- 5. Create resource_links for deliverable_files → deliverables
-- -------------------------------------------------------
INSERT INTO core.resource_links (
  external_resource_id, entity_type, entity_id, link_type
)
SELECT
  er.id,
  'deliverable',
  di.id,
  'attachment'
FROM core.external_resources er
JOIN deliverable_files df ON df.id = er.legacy_resource_id
  AND er.legacy_resource_table = 'deliverable_files'
JOIN core.deliverable_instances di ON di.legacy_deliverable_table = 'deliverables'
  AND di.legacy_deliverable_id = df.deliverable_id
WHERE NOT EXISTS (
  SELECT 1 FROM core.resource_links rl
  WHERE rl.external_resource_id = er.id
    AND rl.entity_type = 'deliverable'
    AND rl.entity_id = di.id
);

-- -------------------------------------------------------
-- 6. Create resource_links for sp_file_pointers → their entities
--    (sp_file_pointers already have entity_type + entity_id)
-- -------------------------------------------------------
INSERT INTO core.resource_links (
  external_resource_id, entity_type, entity_id, link_type
)
SELECT
  er.id,
  sfp.entity_type,
  sfp.entity_id,
  'attachment'
FROM core.external_resources er
JOIN sp_file_pointers sfp ON sfp.id = er.legacy_resource_id
  AND er.legacy_resource_table = 'sp_file_pointers'
WHERE sfp.entity_type IS NOT NULL
  AND sfp.entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.resource_links rl
    WHERE rl.external_resource_id = er.id
      AND rl.entity_type = sfp.entity_type
      AND rl.entity_id = sfp.entity_id
  );

COMMIT;
