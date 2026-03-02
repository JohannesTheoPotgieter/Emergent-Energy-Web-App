import { db } from "./db";
import { sql } from "drizzle-orm";
import { setFeatureFlag } from "./lib/feature-flags";

const LEGACY_TABLES = [
  "normalized_plan_tasks", "operational_tasks", "engineering_tasks",
  "intake_tasks", "mytool_tasks", "project_eng_tasks",
  "working_plan_task_override", "tasks", "qc_item_instance",
];

export async function restoreArchivedLegacyTables(): Promise<void> {
  try {
    for (const table of LEGACY_TABLES) {
      const archiveName = table + "_legacy_archive";
      const archiveExists = (await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${archiveName}') as ex`
      )) as any).rows?.[0]?.ex;
      if (!archiveExists) continue;

      const origExists = (await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
      )) as any).rows?.[0]?.ex;
      if (origExists) continue;

      await db.execute(sql.raw(`ALTER TABLE "${archiveName}" RENAME TO "${table}"`));
      console.log(`[Startup] Restored archived table: ${archiveName} → ${table}`);
    }
  } catch (err) {
    console.error("[Startup] Error restoring archived legacy tables:", err);
  }
}

export async function backfillWorkItems(): Promise<void> {
  try {
    const hasNpt = await db.execute(sql.raw(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'normalized_plan_tasks') as exists
    `));
    if (!(hasNpt as any).rows?.[0]?.exists) {
      console.log("[Backfill] normalized_plan_tasks does not exist, skipping backfill but enabling feature flag");
      await setFeatureFlag("canonical_work_items_v1", true);
      return;
    }

    const hasWi = await db.execute(sql.raw(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_items') as exists
    `));
    if (!(hasWi as any).rows?.[0]?.exists) {
      console.log("[Backfill] work_items does not exist, skipping backfill");
      return;
    }

    await db.execute(sql.raw(`
      DELETE FROM work_items
      WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND legacy_table = 'normalized_plan_tasks'
        AND external_ref LIKE '%::PLAN::%'
    `));

    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM normalized_plan_tasks npt
      WHERE NOT EXISTS (
        SELECT 1 FROM work_items wi
        WHERE wi.external_ref = CONCAT('NPT::', npt.id::text)
      )
    `));
    const missing = Number((countResult as any).rows?.[0]?.cnt ?? 0);

    if (missing === 0) {
      const totalWi = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM work_items WHERE workstream = 'PM' AND source = 'SMART_IMPORT'`));
      console.log(`[Backfill] work_items already synced (${(totalWi as any).rows?.[0]?.cnt ?? 0} PM items), skipping`);
      await setFeatureFlag("canonical_work_items_v1", true, "system-backfill");
      console.log("[Backfill] canonical_work_items_v1 feature flag enabled");
      return;
    }

    console.log(`[Backfill] Backfilling ${missing} normalized_plan_tasks → work_items...`);

    await db.execute(sql.raw(`
      INSERT INTO work_items (
        project_id, workstream, type, source, title, description, status, priority,
        start_date, end_date, duration, percent_complete, wbs_code, outline_number,
        owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
      )
      SELECT
        npt.project_id,
        'PM',
        CASE WHEN npt.is_milestone = true THEN 'milestone' ELSE 'task' END,
        'SMART_IMPORT',
        npt.task_name,
        npt.comment,
        COALESCE(npt.status, 'Not Started'),
        NULL,
        COALESCE(npt.start_date, npt.actual_start_date),
        COALESCE(npt.end_date, npt.actual_end_date),
        COALESCE(npt.duration_days, npt.actual_duration_days),
        COALESCE(npt.pct_complete, 0),
        npt.task_no,
        npt.task_no,
        npt.assignee_user_id,
        false,
        CONCAT('NPT::', npt.id::text),
        'normalized_plan_tasks',
        npt.id,
        npt.assignee_user_id
      FROM normalized_plan_tasks npt
      WHERE NOT EXISTS (
        SELECT 1 FROM work_items wi
        WHERE wi.external_ref = CONCAT('NPT::', npt.id::text)
      )
    `));

    const inserted = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM work_items WHERE workstream = 'PM' AND source = 'SMART_IMPORT'`));
    console.log(`[Backfill] Inserted work_items, total PM items: ${(inserted as any).rows?.[0]?.cnt ?? 0}`);

    await db.execute(sql.raw(`
      UPDATE work_items child
      SET parent_id = parent.id
      FROM work_items parent
      WHERE child.workstream = 'PM'
        AND child.source = 'SMART_IMPORT'
        AND child.parent_id IS NULL
        AND child.wbs_code IS NOT NULL
        AND child.wbs_code LIKE '%.%'
        AND parent.workstream = 'PM'
        AND parent.source = 'SMART_IMPORT'
        AND parent.project_id = child.project_id
        AND parent.wbs_code = SUBSTRING(child.wbs_code FROM '^(.+)\\.[^.]+$')
        AND parent.deleted_at IS NULL
        AND child.deleted_at IS NULL
    `));

    const parentCount = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM work_items
      WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND parent_id IS NOT NULL
    `));
    console.log(`[Backfill] Set parent_id for ${(parentCount as any).rows?.[0]?.cnt ?? 0} child work_items`);

    await db.execute(sql.raw(`
      INSERT INTO work_item_assignments (work_item_id, user_id, role)
      SELECT wi.id, wi.owner_user_id, 'OWNER'
      FROM work_items wi
      WHERE wi.workstream = 'PM'
        AND wi.source = 'SMART_IMPORT'
        AND wi.owner_user_id IS NOT NULL
        AND wi.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM work_item_assignments wia
          WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id
        )
    `));

    console.log("[Backfill] work_items backfill complete");

    await setFeatureFlag("canonical_work_items_v1", true, "system-backfill");
    console.log("[Backfill] canonical_work_items_v1 feature flag enabled");
  } catch (err: any) {
    console.error("[Backfill] work_items backfill error:", err.message);
  }
}
