-- Task-model proof queries: project_eng_tasks vs work_items/work_item_engineering.
-- Safe: READ-ONLY diagnostics for reconciliation and aggregation integrity.

-- A) Legacy-vs-canonical volume by project.
WITH legacy AS (
  SELECT pes.project_id, COUNT(*)::bigint AS legacy_task_count
  FROM public.project_eng_tasks pet
  JOIN public.project_eng_stages pes ON pes.id = pet.project_eng_stage_id
  GROUP BY pes.project_id
), canon AS (
  SELECT wi.project_id, COUNT(*)::bigint AS canonical_eng_task_count
  FROM public.work_items wi
  WHERE wi.workstream = 'ENG'
    AND wi.deleted_at IS NULL
  GROUP BY wi.project_id
)
SELECT
  COALESCE(l.project_id, c.project_id) AS project_id,
  COALESCE(l.legacy_task_count, 0)     AS legacy_task_count,
  COALESCE(c.canonical_eng_task_count, 0) AS canonical_eng_task_count,
  COALESCE(c.canonical_eng_task_count, 0) - COALESCE(l.legacy_task_count, 0) AS delta
FROM legacy l
FULL OUTER JOIN canon c ON c.project_id = l.project_id
ORDER BY ABS(COALESCE(c.canonical_eng_task_count, 0) - COALESCE(l.legacy_task_count, 0)) DESC, 1;

-- B) Bridge coverage: project_eng_tasks rows with/without mapped work_item.
SELECT
  COUNT(*)::bigint AS total_project_eng_tasks,
  COUNT(*) FILTER (WHERE work_item_id IS NOT NULL)::bigint AS linked_to_work_items,
  COUNT(*) FILTER (WHERE work_item_id IS NULL)::bigint     AS missing_work_item_link
FROM public.project_eng_tasks;

-- C) Imported engineering provenance sanity.
SELECT
  COUNT(*)::bigint AS eng_work_items,
  COUNT(wie.id)::bigint AS eng_with_engineering_extension,
  (COUNT(*) - COUNT(wie.id))::bigint AS eng_missing_engineering_extension
FROM public.work_items wi
LEFT JOIN public.work_item_engineering wie ON wie.work_item_id = wi.id
WHERE wi.workstream = 'ENG'
  AND wi.deleted_at IS NULL;

-- D) Aggregation corruption probe: duplicated work_item_engineering rows should be impossible.
SELECT
  wie.work_item_id,
  COUNT(*)::bigint AS dup_rows
FROM public.work_item_engineering wie
GROUP BY wie.work_item_id
HAVING COUNT(*) > 1
ORDER BY dup_rows DESC, wie.work_item_id;

-- E) Aggregation parity on completion (legacy status vs canonical status).
WITH legacy AS (
  SELECT pes.project_id,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(pet.status, '')) IN ('complete','completed'))::bigint AS legacy_completed
  FROM public.project_eng_tasks pet
  JOIN public.project_eng_stages pes ON pes.id = pet.project_eng_stage_id
  GROUP BY pes.project_id
), canon AS (
  SELECT wi.project_id,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(wi.status, '')) IN ('complete','completed'))::bigint AS canonical_completed
  FROM public.work_items wi
  WHERE wi.workstream = 'ENG'
    AND wi.deleted_at IS NULL
  GROUP BY wi.project_id
)
SELECT
  COALESCE(l.project_id, c.project_id) AS project_id,
  COALESCE(l.legacy_completed, 0)      AS legacy_completed,
  COALESCE(c.canonical_completed, 0)   AS canonical_completed,
  COALESCE(c.canonical_completed, 0) - COALESCE(l.legacy_completed, 0) AS delta_completed
FROM legacy l
FULL OUTER JOIN canon c ON c.project_id = l.project_id
ORDER BY ABS(COALESCE(c.canonical_completed, 0) - COALESCE(l.legacy_completed, 0)) DESC, 1;
