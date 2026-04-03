-- Backfill: 20260403_c06_backfill_work_item_dependencies_clean.sql
-- Phase C.3: Populate core.work_item_dependencies_clean from work_item_dependencies.
-- Maps legacy work_item IDs to clean work_item IDs via legacy_work_item_id.
-- Excludes soft-deleted dependencies.
-- Idempotent: ON CONFLICT DO NOTHING on unique (predecessor_id, successor_id, dep_type).
-- Must run AFTER: 20260403_c05_create_work_item_dependencies_clean.sql
BEGIN;

INSERT INTO core.work_item_dependencies_clean (
  predecessor_id,
  successor_id,
  dep_type,
  lag_days
)
SELECT
  pred.id,
  succ.id,
  wid.dep_type,
  wid.lag_days
FROM work_item_dependencies wid
JOIN core.work_items_clean pred ON pred.legacy_work_item_id = wid.predecessor_id
JOIN core.work_items_clean succ ON succ.legacy_work_item_id = wid.successor_id
WHERE wid.deleted_at IS NULL
ON CONFLICT (predecessor_id, successor_id, dep_type) DO NOTHING;

COMMIT;
