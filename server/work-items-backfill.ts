import { db } from "./db";
import { sql } from "drizzle-orm";
import { setFeatureFlag } from "./lib/feature-flags";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql.raw(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}') as ex`
  ));
  return (result as any).rows?.[0]?.ex === true;
}

async function resolveTable(name: string): Promise<string | null> {
  if (await tableExists(name)) return name;
  const archived = name + "_legacy_archive";
  if (await tableExists(archived)) return archived;
  return null;
}

async function backfillFromTable(
  sourceTable: string,
  refPrefix: string,
  insertSql: string,
): Promise<number> {
  const countResult = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM "${sourceTable}" src
    WHERE NOT EXISTS (
      SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('${refPrefix}', src.id::text)
    )
  `));
  const missing = Number((countResult as any).rows?.[0]?.cnt ?? 0);
  if (missing === 0) return 0;

  await db.execute(sql.raw(insertSql));
  return missing;
}

async function migrateTable(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    console.error(`[Backfill] Error migrating ${name}:`, err.message);
  }
}

export async function backfillWorkItems(): Promise<void> {
  try {
    if (!(await tableExists("work_items"))) {
      console.log("[Backfill] work_items table does not exist, skipping");
      return;
    }

    await db.execute(sql.raw(`
      DELETE FROM work_items
      WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND legacy_table = 'normalized_plan_tasks'
        AND external_ref LIKE '%::PLAN::%'
    `));

    await migrateTable("normalized_plan_tasks", async () => {
      const nptTable = await resolveTable("normalized_plan_tasks");
      if (!nptTable) {
        console.log("[Backfill] normalized_plan_tasks not found, skipping");
        return;
      }
      const count = await backfillFromTable(nptTable, "NPT::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete, wbs_code, outline_number,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by,
          actual_start, actual_end, actual_duration
        )
        SELECT
          npt.project_id, 'PM',
          CASE WHEN npt.is_milestone = true THEN 'milestone' ELSE 'task' END,
          'SMART_IMPORT', npt.task_name, npt.comment,
          COALESCE(npt.status, 'Not Started'), NULL,
          COALESCE(npt.start_date, npt.actual_start_date),
          COALESCE(npt.end_date, npt.actual_end_date),
          COALESCE(npt.duration_days, npt.actual_duration_days),
          COALESCE(npt.pct_complete, 0),
          npt.task_no, npt.task_no, npt.assignee_user_id, false,
          CONCAT('NPT::', npt.id::text), 'normalized_plan_tasks', npt.id, npt.assignee_user_id,
          npt.actual_start_date, npt.actual_end_date, npt.actual_duration_days
        FROM "${nptTable}" npt
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('NPT::', npt.id::text)
        )
        AND NOT EXISTS (
          SELECT 1 FROM work_items wi2
          WHERE wi2.project_id = npt.project_id
            AND wi2.title = npt.task_name
            AND wi2.source = 'SMART_IMPORT'
            AND wi2.deleted_at IS NULL
        )
      `);
      if (count > 0) console.log(`[Backfill] Migrated ${count} normalized_plan_tasks → work_items`);

      await db.execute(sql.raw(`
        UPDATE work_items child
        SET parent_id = parent.id
        FROM work_items parent
        WHERE child.workstream = 'PM' AND child.source = 'SMART_IMPORT'
          AND child.parent_id IS NULL AND child.wbs_code IS NOT NULL AND child.wbs_code LIKE '%.%'
          AND parent.workstream = 'PM' AND parent.source = 'SMART_IMPORT'
          AND parent.project_id = child.project_id
          AND parent.wbs_code = SUBSTRING(child.wbs_code FROM '^(.+)\\.[^.]+$')
          AND parent.deleted_at IS NULL AND child.deleted_at IS NULL
      `));

      await db.execute(sql.raw(`
        INSERT INTO work_item_assignments (work_item_id, user_id, role)
        SELECT wi.id, wi.owner_user_id, 'OWNER'
        FROM work_items wi
        WHERE wi.legacy_table = 'normalized_plan_tasks' AND wi.owner_user_id IS NOT NULL AND wi.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id)
      `));
    });

    await migrateTable("operational_tasks", async () => {
      const otTable = await resolveTable("operational_tasks");
      if (!otTable) return;

      // Fix previously-migrated operational_tasks that were incorrectly set to 'PM'
      // operational_tasks are engineering/ops tasks and should use workstream 'ENG'
      const fixedRows = await db.execute(sql.raw(`
        UPDATE work_items SET workstream = 'ENG'
        WHERE legacy_table = 'operational_tasks' AND workstream = 'PM' AND deleted_at IS NULL
        RETURNING id
      `));
      const fixedCount = (fixedRows as any).rows?.length ?? 0;
      if (fixedCount > 0) {
        console.log(`[Backfill] Fixed ${fixedCount} operational_tasks work_items: workstream PM → ENG`);
      }

      // Sync engineering-specific fields that were missing in the original migration
      if (await tableExists(otTable)) {
        await db.execute(sql.raw(`
          UPDATE work_items wi SET
            hold_reason = COALESCE(wi.hold_reason, ot.hold_reason),
            blocked_type = COALESCE(wi.blocked_type, ot.blocked_type),
            blocker_reason = COALESCE(wi.blocker_reason, ot.blocker_reason),
            approval_required = COALESCE(ot.approval_required, false),
            completed_at = COALESCE(wi.completed_at, ot.completed_at),
            tracking_rag = COALESCE(wi.tracking_rag, ot.tracking_rag),
            task_type_tag = COALESCE(wi.task_type_tag, ot.task_type_tag),
            duration = COALESCE(wi.duration, ot.duration_days),
            percent_complete = COALESCE(ot.percent_complete, wi.percent_complete)
          FROM "${otTable}" ot
          WHERE wi.legacy_table = 'operational_tasks'
            AND wi.legacy_id = ot.id
            AND wi.deleted_at IS NULL
        `));
      }

      const count = await backfillFromTable(otTable, "OT::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by,
          hold_reason, blocked_type, blocker_reason, approval_required, completed_at,
          tracking_rag, task_type_tag
        )
        SELECT
          ot.project_id, 'ENG', 'task', 'UI', ot.title, ot.description,
          CASE COALESCE(ot.status, 'TO DO')
            WHEN 'TO DO' THEN 'Not Started'
            WHEN 'IN PROGRESS' THEN 'In Progress'
            WHEN 'COMPLETE' THEN 'Complete'
            WHEN 'HOLD' THEN 'On Hold'
            WHEN 'NEEDS APPROVAL' THEN 'In Progress'
            WHEN 'QC APPROVED' THEN 'Complete'
            WHEN 'PROVIDE FEEDBACK' THEN 'In Progress'
            WHEN 'PROJECTS ASSISTANCE' THEN 'In Progress'
            ELSE 'Not Started'
          END, ot.priority,
          ot.start_date, ot.due_date, ot.duration_days, COALESCE(ot.percent_complete, 0),
          ot.owner_user_id, false,
          CONCAT('OT::', ot.id::text), 'operational_tasks', ot.id, ot.requester_user_id,
          ot.hold_reason, ot.blocked_type, ot.blocker_reason,
          COALESCE(ot.approval_required, false), ot.completed_at,
          ot.tracking_rag, ot.task_type_tag
        FROM "${otTable}" ot
        WHERE ot.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('OT::', ot.id::text)
          )
      `);
      if (count > 0) {
        console.log(`[Backfill] Migrated ${count} operational_tasks → work_items`);
      }

      // Ensure owner assignments exist for all operational_tasks work_items
      await db.execute(sql.raw(`
        INSERT INTO work_item_assignments (work_item_id, user_id, role)
        SELECT wi.id, wi.owner_user_id, 'OWNER'
        FROM work_items wi
        WHERE wi.legacy_table = 'operational_tasks' AND wi.owner_user_id IS NOT NULL AND wi.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id)
      `));

      // Migrate assignee_user_ids array from operational_tasks into work_item_assignments
      if (await tableExists(otTable)) {
        await db.execute(sql.raw(`
          INSERT INTO work_item_assignments (work_item_id, user_id, role)
          SELECT wi.id, uid, 'ASSIGNEE'
          FROM work_items wi
          JOIN "${otTable}" ot ON wi.legacy_id = ot.id AND wi.legacy_table = 'operational_tasks'
          CROSS JOIN LATERAL unnest(ot.assignee_user_ids) AS uid
          WHERE wi.deleted_at IS NULL
            AND ot.assignee_user_ids IS NOT NULL
            AND array_length(ot.assignee_user_ids, 1) > 0
            AND NOT EXISTS (
              SELECT 1 FROM work_item_assignments wia
              WHERE wia.work_item_id = wi.id AND wia.user_id = uid
            )
        `));
      }
    });

    await migrateTable("engineering_tasks", async () => {
      const etTable = await resolveTable("engineering_tasks");
      if (!etTable) return;
      const count = await backfillFromTable(etTable, "ET::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          et.project_id, 'ENG', 'task', 'UI', et.title, et.description,
          COALESCE(et.status, 'NOT_STARTED'), NULL,
          NULL, NULL, NULL,
          CASE WHEN et.status = 'DONE' THEN 1 ELSE 0 END,
          et.assignee_user_id, false,
          CONCAT('ET::', et.id::text), 'engineering_tasks', et.id, et.assignee_user_id
        FROM "${etTable}" et
        WHERE et.soft_deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('ET::', et.id::text)
          )
      `);
      if (count > 0) {
        console.log(`[Backfill] Migrated ${count} engineering_tasks → work_items`);
        await db.execute(sql.raw(`
          INSERT INTO work_item_assignments (work_item_id, user_id, role)
          SELECT wi.id, wi.owner_user_id, 'OWNER'
          FROM work_items wi
          WHERE wi.legacy_table = 'engineering_tasks' AND wi.owner_user_id IS NOT NULL AND wi.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id)
        `));
      }
    });

    await migrateTable("mytool_tasks", async () => {
      const mtTable = await resolveTable("mytool_tasks");
      if (!mtTable) return;
      const count = await backfillFromTable(mtTable, "MT::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          NULL, 'PERSONAL', 'task', 'UI', mt.title, mt.notes,
          COALESCE(mt.status, 'inbox'), mt.priority,
          mt.start_date, mt.planned_for_date, NULL,
          CASE WHEN mt.status = 'done' THEN 1 ELSE 0 END,
          mt.owner_user_id, false,
          CONCAT('MT::', mt.id::text), 'mytool_tasks', mt.id, mt.owner_user_id
        FROM "${mtTable}" mt
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('MT::', mt.id::text)
        )
      `);
      if (count > 0) console.log(`[Backfill] Migrated ${count} mytool_tasks → work_items`);
    });

    await migrateTable("tasks", async () => {
      const tasksTable = await resolveTable("tasks");
      if (!tasksTable) return;
      const count = await backfillFromTable(tasksTable, "TASK::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          t.project_id, 'PM', 'task', 'UI', t.task_name, NULL,
          COALESCE(t.status, 'Not Started'), NULL,
          t.start_date, t.end_date, NULL,
          COALESCE(t.progress::real / 100.0, 0),
          NULL, false,
          CONCAT('TASK::', t.id::text), 'tasks', t.id, NULL
        FROM "${tasksTable}" t
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('TASK::', t.id::text)
        )
      `);
      if (count > 0) console.log(`[Backfill] Migrated ${count} tasks → work_items`);
    });

    await migrateTable("intake_tasks", async () => {
      const itTable = await resolveTable("intake_tasks");
      if (!itTable) return;
      const count = await backfillFromTable(itTable, "IT::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          NULL, 'PD', 'task', 'UI', it.title, it.description,
          COALESCE(it.status, 'NOT_STARTED'), NULL,
          NULL, it.due_date, NULL,
          CASE WHEN it.status = 'DONE' THEN 1 ELSE 0 END,
          NULL, false,
          CONCAT('IT::', it.id::text), 'intake_tasks', it.id, NULL
        FROM "${itTable}" it
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('IT::', it.id::text)
        )
      `);
      if (count > 0) console.log(`[Backfill] Migrated ${count} intake_tasks → work_items`);
    });

    await migrateTable("project_eng_tasks", async () => {
      const petTable = await resolveTable("project_eng_tasks");
      if (!petTable) return;
      const count = await backfillFromTable(petTable, "PET::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          pes.project_id, 'ENG', 'task', 'SYSTEM',
          COALESCE(ett.title, 'Engineering Task #' || pet.id::text),
          pet.notes,
          COALESCE(pet.status, 'pending'), NULL,
          NULL, pet.due_date, NULL,
          CASE WHEN pet.status = 'complete' THEN 1 ELSE 0 END,
          pet.owner_user_id, false,
          CONCAT('PET::', pet.id::text), 'project_eng_tasks', pet.id, pet.completed_by
        FROM "${petTable}" pet
        JOIN project_eng_stages pes ON pet.project_eng_stage_id = pes.id
        LEFT JOIN eng_task_templates ett ON pet.task_template_id = ett.id
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('PET::', pet.id::text)
        )
      `);
      if (count > 0) {
        console.log(`[Backfill] Migrated ${count} project_eng_tasks → work_items`);
        await db.execute(sql.raw(`
          INSERT INTO work_item_assignments (work_item_id, user_id, role)
          SELECT wi.id, wi.owner_user_id, 'OWNER'
          FROM work_items wi
          WHERE wi.legacy_table = 'project_eng_tasks' AND wi.owner_user_id IS NOT NULL AND wi.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id)
        `));
      }
    });

    await migrateTable("qc_item_instance", async () => {
      const qciTable = await resolveTable("qc_item_instance");
      if (!qciTable) return;
      const count = await backfillFromTable(qciTable, "QCI::", `
        INSERT INTO work_items (
          project_id, workstream, type, source, title, description, status, priority,
          start_date, end_date, duration, percent_complete,
          owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by
        )
        SELECT
          qc.project_id, 'QUALITY', 'task', 'SYSTEM',
          COALESCE(qti.item_name, 'QC Item #' || qi.id::text),
          NULL,
          COALESCE(qi.qm_status, 'not_checked'), NULL,
          NULL, NULL, NULL,
          CASE WHEN qi.qm_status = 'pass' THEN 1 ELSE 0 END,
          qi.assignee_user_id, false,
          CONCAT('QCI::', qi.id::text), 'qc_item_instance', qi.id, NULL
        FROM "${qciTable}" qi
        JOIN qc_checklist qc ON qi.checklist_id = qc.id
        LEFT JOIN qc_template_item qti ON qi.template_item_id = qti.id
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('QCI::', qi.id::text)
        )
      `);
      if (count > 0) {
        console.log(`[Backfill] Migrated ${count} qc_item_instance → work_items`);
        await db.execute(sql.raw(`
          INSERT INTO work_item_assignments (work_item_id, user_id, role)
          SELECT wi.id, wi.owner_user_id, 'OWNER'
          FROM work_items wi
          WHERE wi.legacy_table = 'qc_item_instance' AND wi.owner_user_id IS NOT NULL AND wi.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = wi.owner_user_id)
        `));
      }
    });

    await migrateTable("project_plan", async () => {
      const ppTable = await resolveTable("project_plan");
      if (!ppTable) return;
      const ppCountResult = await db.execute(sql.raw(`
        SELECT COUNT(*) as cnt FROM "${ppTable}" pp
        JOIN project_info pi ON pi.project_name = pp.project_name
        WHERE NOT EXISTS (
          SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('PP::', pp.id::text)
        )
        AND NOT EXISTS (
          SELECT 1 FROM work_items wi
          WHERE wi.project_id = pi.id AND wi.workstream = 'PM' AND wi.source = 'SMART_IMPORT' AND wi.deleted_at IS NULL
        )
      `));
      const ppMissing = Number((ppCountResult as any).rows?.[0]?.cnt ?? 0);
      if (ppMissing > 0) {
        await db.execute(sql.raw(`
          INSERT INTO work_items (
            project_id, workstream, type, source, title, description, status, priority,
            start_date, end_date, duration, percent_complete, wbs_code, outline_number,
            owner_user_id, is_shared, external_ref, legacy_table, legacy_id, created_by,
            actual_start, actual_end, actual_duration
          )
          SELECT
            pi.id, 'PM', 'task', 'SMART_IMPORT',
            COALESCE(pp.high_level_programme, 'Task ' || COALESCE(pp.task_no, pp.row_number::text)),
            NULL,
            CASE
              WHEN COALESCE(pp.actual_pct_complete, 0) >= 1 THEN 'Done'
              WHEN COALESCE(pp.actual_pct_complete, 0) > 0 THEN 'In Progress'
              ELSE 'Not Started'
            END,
            NULL,
            pp.actual_start, pp.actual_end, pp.duration_days,
            COALESCE(pp.actual_pct_complete, 0),
            pp.task_no, pp.task_no,
            NULL, false,
            CONCAT('PP::', pp.id::text), 'project_plan', pp.id, NULL,
            pp.actual_start, pp.actual_end, pp.duration_days
          FROM "${ppTable}" pp
          JOIN project_info pi ON pi.project_name = pp.project_name
          WHERE NOT EXISTS (
            SELECT 1 FROM work_items wi WHERE wi.external_ref = CONCAT('PP::', pp.id::text)
          )
          AND NOT EXISTS (
            SELECT 1 FROM work_items wi
            WHERE wi.project_id = pi.id AND wi.workstream = 'PM' AND wi.source = 'SMART_IMPORT' AND wi.deleted_at IS NULL
          )
        `));
        console.log(`[Backfill] Migrated ${ppMissing} project_plan → work_items (projects without NPT data)`);

        await db.execute(sql.raw(`
          UPDATE work_items child
          SET parent_id = parent.id
          FROM work_items parent
          WHERE child.legacy_table = 'project_plan' AND child.parent_id IS NULL
            AND child.wbs_code IS NOT NULL AND child.wbs_code LIKE '%.%'
            AND parent.legacy_table = 'project_plan'
            AND parent.project_id = child.project_id
            AND parent.wbs_code = SUBSTRING(child.wbs_code FROM '^(.+)\\.[^.]+$')
            AND parent.deleted_at IS NULL AND child.deleted_at IS NULL
        `));
      }
    });

    // Recover ENG work items that lost their projectId due to the PATCH bug
    // (projectName was accepted but never resolved to projectId before commit a00a843)
    const recoveredProjectIds = await db.execute(sql.raw(`
      UPDATE work_items wi SET project_id = pi.id
      FROM project_info pi
      WHERE wi.workstream = 'ENG'
        AND wi.project_id IS NULL
        AND wi.deleted_at IS NULL
        AND wi.legacy_table = 'operational_tasks'
        AND wi.legacy_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM operational_tasks ot
          WHERE ot.id = wi.legacy_id AND ot.project_id = pi.id
        )
      RETURNING wi.id
    `));
    const recoveredCount = (recoveredProjectIds as any).rows?.length ?? 0;
    if (recoveredCount > 0) {
      console.log(`[Backfill] Recovered projectId for ${recoveredCount} orphaned ENG work_items`);
    }

    const totalWi = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM work_items`));
    console.log(`[Backfill] Total work_items: ${(totalWi as any).rows?.[0]?.cnt ?? 0}`);

    await setFeatureFlag("canonical_work_items_v1", true, "system-backfill");
    console.log("[Backfill] canonical_work_items_v1 feature flag enabled");
    console.log("[Backfill] All legacy table migration complete");
  } catch (err: any) {
    console.error("[Backfill] work_items backfill error:", err.message);
    await setFeatureFlag("canonical_work_items_v1", true, "system-backfill");
  }
}
