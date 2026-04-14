-- Data Integrity: FK risk register focused on project_info and task-model overlap.
-- Safe: READ-ONLY diagnostics.

-- 1) Foreign keys that reference project_info, including on_delete behavior.
SELECT
  con.conname                                       AS fk_name,
  src_ns.nspname || '.' || src.relname             AS source_table,
  att.attname                                       AS source_column,
  tgt_ns.nspname || '.' || tgt.relname             AS target_table,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confdeltype::text
  END                                               AS on_delete,
  con.condeferrable,
  con.condeferred
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS src_key(attnum, ord) ON true
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = src_key.attnum
WHERE con.contype = 'f'
  AND tgt.relname = 'project_info'
  AND tgt_ns.nspname = 'public'
ORDER BY source_table, source_column, fk_name;

-- 2) Highest-risk relationships: NO ACTION/RESTRICT and nullable project_id.
SELECT
  con.conname                                       AS fk_name,
  src_ns.nspname || '.' || src.relname             AS source_table,
  att.attname                                       AS source_column,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confdeltype::text
  END                                               AS on_delete,
  NOT att.attnotnull                                AS fk_column_nullable
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS src_key(attnum, ord) ON true
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = src_key.attnum
WHERE con.contype = 'f'
  AND tgt.relname = 'project_info'
  AND tgt_ns.nspname = 'public'
  AND con.confdeltype IN ('a', 'r')
ORDER BY source_table, source_column;

-- 3) Orphan check for work_items -> project_info.
SELECT COUNT(*)::bigint AS orphan_work_items
FROM public.work_items wi
LEFT JOIN public.project_info pi ON pi.id = wi.project_id
WHERE wi.project_id IS NOT NULL
  AND pi.id IS NULL
  AND wi.deleted_at IS NULL;

-- 4) Orphan check for project_eng_tasks -> work_items bridge.
SELECT COUNT(*)::bigint AS orphan_project_eng_tasks_work_item_links
FROM public.project_eng_tasks pet
LEFT JOIN public.work_items wi ON wi.id = pet.work_item_id
WHERE pet.work_item_id IS NOT NULL
  AND wi.id IS NULL;

-- 5) Orphan check for work_item_engineering -> work_items.
SELECT COUNT(*)::bigint AS orphan_work_item_engineering_rows
FROM public.work_item_engineering wie
LEFT JOIN public.work_items wi ON wi.id = wie.work_item_id
WHERE wi.id IS NULL;
