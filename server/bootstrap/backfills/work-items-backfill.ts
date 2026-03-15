import { sql } from "drizzle-orm";
import { db } from "../../db";

export async function runWorkItemsBackfill(
  startupBackfillEnabled: boolean,
  allowStartupMutations: boolean,
) {
  if (!startupBackfillEnabled) return;

  await db.execute(sql.raw(`
    UPDATE work_items wi
    SET actual_start = COALESCE(wi.actual_start, npt.actual_start_date),
        actual_end = COALESCE(wi.actual_end, npt.actual_end_date),
        actual_duration = COALESCE(wi.actual_duration, npt.actual_duration_days)
    FROM normalized_plan_tasks npt
    WHERE wi.legacy_table = 'normalized_plan_tasks'
      AND wi.legacy_id = npt.id
      AND (wi.actual_start IS NULL OR wi.actual_end IS NULL)
      AND (npt.actual_start_date IS NOT NULL OR npt.actual_end_date IS NOT NULL)
  `));

  await db.execute(sql.raw(`
    UPDATE work_items wi
    SET actual_start = COALESCE(wi.actual_start, npt.actual_start_date),
        actual_end = COALESCE(wi.actual_end, npt.actual_end_date),
        actual_duration = COALESCE(wi.actual_duration, npt.actual_duration_days)
    FROM normalized_plan_tasks npt
    WHERE wi.source = 'SMART_IMPORT'
      AND (wi.actual_start IS NULL OR wi.actual_end IS NULL)
      AND wi.project_id = npt.project_id
      AND wi.title = npt.task_name
      AND wi.deleted_at IS NULL
      AND (npt.actual_start_date IS NOT NULL OR npt.actual_end_date IS NOT NULL)
  `));

  if (allowStartupMutations) {
    const { backfillWorkItems } = await import("../../work-items-backfill");
    await backfillWorkItems();
  }
}
