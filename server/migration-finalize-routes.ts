import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from "./departments/shared-middleware";
import { verifyToken } from "./jwt";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { runMigrationVerification } from "./migration-verify";

const router = Router();

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const decoded = verifyToken(authHeader.slice(7));
    if (decoded && !req.user) {
      (req as any).user = decoded;
    }
  }
  next();
}

const LEGACY_TABLES = [
  "normalized_plan_tasks",
  "engineering_tasks",
  "qc_item_instance",
  "operational_tasks",
  "mytool_tasks",
  "tasks",
  "intake_tasks",
  "project_eng_tasks",
];

const ARCHIVE_SUFFIX = "_legacy_archive";
const DROP_COOLDOWN_DAYS = 7;

function getRows(result: any): any[] {
  return Array.isArray(result) ? result : (result.rows || []);
}

router.get("/api/admin/migration/status", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const archiveStatus: Record<string, { exists: boolean; archived: boolean; archivedName: string | null; rowCount: number }> = {};

    for (const table of LEGACY_TABLES) {
      const archivedName = table + ARCHIVE_SUFFIX;
      const origExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
      )))[0]?.ex === true;
      const archExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${archivedName}') as ex`
      )))[0]?.ex === true;

      let rowCount = 0;
      if (origExists) {
        rowCount = Number(getRows(await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`)))[0]?.cnt ?? 0);
      } else if (archExists) {
        rowCount = Number(getRows(await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${archivedName}"`)))[0]?.cnt ?? 0);
      }

      archiveStatus[table] = {
        exists: origExists,
        archived: archExists && !origExists,
        archivedName: archExists ? archivedName : null,
        rowCount,
      };
    }

    const logs = getRows(await db.execute(sql.raw(
      `SELECT * FROM migration_cleanup_log ORDER BY performed_at DESC LIMIT 50`
    )));

    const backups = getRows(await db.execute(sql.raw(
      `SELECT * FROM migration_backups ORDER BY created_at DESC LIMIT 10`
    )));

    const archiveLog = logs.find((l: any) => l.action === "ARCHIVE");
    const archiveDate = archiveLog?.performed_at ? new Date(archiveLog.performed_at) : null;
    const cooldownEnd = archiveDate ? new Date(archiveDate.getTime() + DROP_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) : null;
    const dropEnabled = cooldownEnd ? new Date() >= cooldownEnd : false;

    res.json({
      legacyTables: archiveStatus,
      logs,
      backups,
      cooldown: {
        archiveDate: archiveDate?.toISOString() || null,
        cooldownEnd: cooldownEnd?.toISOString() || null,
        dropEnabled,
        remainingDays: cooldownEnd ? Math.max(0, Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/migration/verify", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const report = await runMigrationVerification();

    const sampleProjects = getRows(await db.execute(sql.raw(`
      SELECT pi.project_name, 
        (SELECT COUNT(*) FROM normalized_plan_tasks npt WHERE npt.project_name = pi.project_name) as legacy_count,
        (SELECT COUNT(*) FROM work_items wi WHERE wi.project_id = pi.id AND wi.workstream = 'PM' AND wi.deleted_at IS NULL) as canonical_count
      FROM project_info pi
      ORDER BY pi.project_name
      LIMIT 10
    `)));

    const legacyTableCounts: Record<string, number> = {};
    for (const table of LEGACY_TABLES) {
      try {
        const exists = getRows(await db.execute(sql.raw(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
        )))[0]?.ex === true;
        if (exists) {
          legacyTableCounts[table] = Number(getRows(await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`)))[0]?.cnt ?? 0);
        } else {
          legacyTableCounts[table] = -1;
        }
      } catch {
        legacyTableCounts[table] = -1;
      }
    }

    res.json({
      ...report,
      sampleProjects,
      legacyTableCounts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/migration/register-backup", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { backupId, description } = req.body;
    if (!backupId || typeof backupId !== "string" || backupId.trim().length < 3) {
      return res.status(400).json({ error: "A valid backup ID string (min 3 characters) is required" });
    }

    const currentUser = (req as any).user;
    const userName = (currentUser.name || currentUser.username || "admin").replace(/'/g, "''");
    const safeBackupId = backupId.replace(/'/g, "''");
    const safeDesc = (description || "Pre-migration backup").replace(/'/g, "''");
    await db.execute(sql.raw(`
      INSERT INTO migration_backups (backup_id, backup_type, description, created_by_user_id, created_by_name)
      VALUES ('${safeBackupId}', 'manual', '${safeDesc}', ${currentUser.id}, '${userName}')
    `));

    res.json({ success: true, backupId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/migration/check-references", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const references: { table: string; referenceType: string; detail: string }[] = [];

    for (const table of LEGACY_TABLES) {
      const exists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
      )))[0]?.ex === true;
      if (!exists) continue;

      const fkRefs = getRows(await db.execute(sql.raw(`
        SELECT tc.table_name as referencing_table, kcu.column_name, ccu.table_name as referenced_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = '${table}'
        AND tc.table_schema = 'public'
      `)));

      for (const fk of fkRefs) {
        if (!LEGACY_TABLES.includes(fk.referencing_table) && !fk.referencing_table.endsWith(ARCHIVE_SUFFIX)) {
          references.push({
            table,
            referenceType: "FOREIGN_KEY",
            detail: `Table "${fk.referencing_table}" column "${fk.column_name}" references "${table}"`,
          });
        }
      }

      const viewRefs = getRows(await db.execute(sql.raw(`
        SELECT viewname FROM pg_views 
        WHERE schemaname = 'public' AND definition LIKE '%${table}%'
      `)));
      for (const v of viewRefs) {
        references.push({
          table,
          referenceType: "VIEW",
          detail: `View "${v.viewname}" references "${table}"`,
        });
      }

      const triggerRefs = getRows(await db.execute(sql.raw(`
        SELECT trigger_name, event_object_table FROM information_schema.triggers
        WHERE event_object_schema = 'public' AND event_object_table = '${table}'
      `)));
      for (const t of triggerRefs) {
        references.push({
          table,
          referenceType: "TRIGGER",
          detail: `Trigger "${t.trigger_name}" on "${table}"`,
        });
      }
    }

    res.json({ references, safe: references.length === 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/migration/archive", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { confirmation, backupId } = req.body;
    if (confirmation !== "DROP_LEGACY_TABLES") {
      return res.status(400).json({ error: "Confirmation text must be exactly 'DROP_LEGACY_TABLES'" });
    }

    const backups = getRows(await db.execute(sql.raw(
      `SELECT * FROM migration_backups WHERE backup_id = '${(backupId || "").replace(/'/g, "''")}'`
    )));
    if (backups.length === 0) {
      return res.status(400).json({ error: "No registered backup found with that ID. Register a backup first." });
    }

    const currentUser = (req as any).user;
    const archived: string[] = [];
    const skipped: string[] = [];
    const droppedConstraints: string[] = [];

    for (const table of LEGACY_TABLES) {
      const exists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
      )))[0]?.ex === true;

      if (!exists) {
        skipped.push(table);
        continue;
      }

      const fkRefs = getRows(await db.execute(sql.raw(`
        SELECT tc.constraint_name, tc.table_name as referencing_table, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = '${table}'
        AND tc.table_schema = 'public'
      `)));

      for (const fk of fkRefs) {
        if (!LEGACY_TABLES.includes(fk.referencing_table) && !fk.referencing_table.endsWith(ARCHIVE_SUFFIX)) {
          try {
            await db.execute(sql.raw(`ALTER TABLE "${fk.referencing_table}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`));
            droppedConstraints.push(`${fk.referencing_table}.${fk.constraint_name}`);
          } catch (dropErr: any) {
            console.warn(`[Migration] Failed to drop FK ${fk.constraint_name}:`, dropErr.message);
          }
        }
      }

      const selfFkRefs = getRows(await db.execute(sql.raw(`
        SELECT tc.constraint_name, tc.table_name as referencing_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${table}'
        AND tc.table_schema = 'public'
      `)));

      for (const fk of selfFkRefs) {
        try {
          await db.execute(sql.raw(`ALTER TABLE "${fk.referencing_table}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`));
          droppedConstraints.push(`${fk.referencing_table}.${fk.constraint_name} (self)`);
        } catch (dropErr: any) {
          console.warn(`[Migration] Failed to drop self FK ${fk.constraint_name}:`, dropErr.message);
        }
      }

      const archivedName = table + ARCHIVE_SUFFIX;
      const archiveExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${archivedName}') as ex`
      )))[0]?.ex === true;

      if (archiveExists) {
        skipped.push(table);
        continue;
      }

      const rowCount = Number(getRows(await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`)))[0]?.cnt ?? 0);

      await db.execute(sql.raw(`ALTER TABLE "${table}" RENAME TO "${archivedName}"`));

      await db.execute(sql.raw(`
        INSERT INTO migration_cleanup_log (action, table_name, original_name, archived_name, row_count, performed_by_user_id, performed_by_name, backup_id, reversible)
        VALUES ('ARCHIVE', '${table}', '${table}', '${archivedName}', ${rowCount}, ${currentUser.id}, '${(currentUser.name || currentUser.username || "admin").replace(/'/g, "''")}', '${(backupId || "").replace(/'/g, "''")}', true)
      `));

      archived.push(table);
    }

    res.json({ success: true, archived, skipped, droppedConstraints });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/migration/restore", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { tables } = req.body;
    const requested: string[] = tables && Array.isArray(tables) ? tables : LEGACY_TABLES;
    const tablesToRestore = requested.filter(t => LEGACY_TABLES.includes(t));

    const currentUser = (req as any).user;
    const restored: string[] = [];
    const skipped: string[] = [];

    for (const table of tablesToRestore) {
      const archivedName = table + ARCHIVE_SUFFIX;
      const archiveExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${archivedName}') as ex`
      )))[0]?.ex === true;

      if (!archiveExists) {
        skipped.push(table);
        continue;
      }

      const origExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
      )))[0]?.ex === true;

      if (origExists) {
        skipped.push(table);
        continue;
      }

      await db.execute(sql.raw(`ALTER TABLE "${archivedName}" RENAME TO "${table}"`));

      await db.execute(sql.raw(`
        INSERT INTO migration_cleanup_log (action, table_name, original_name, archived_name, row_count, performed_by_user_id, performed_by_name, reversible)
        VALUES ('RESTORE', '${table}', '${table}', '${archivedName}', 0, ${currentUser.id}, '${(currentUser.name || currentUser.username).replace(/'/g, "''")}', true)
      `));

      restored.push(table);
    }

    res.json({ success: true, restored, skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/migration/drop-archived", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { confirmation } = req.body;
    if (confirmation !== "DROP_LEGACY_TABLES") {
      return res.status(400).json({ error: "Confirmation text must be exactly 'DROP_LEGACY_TABLES'" });
    }

    const archiveLogs = getRows(await db.execute(sql.raw(
      `SELECT performed_at FROM migration_cleanup_log WHERE action = 'ARCHIVE' ORDER BY performed_at DESC LIMIT 1`
    )));

    if (archiveLogs.length === 0) {
      return res.status(400).json({ error: "No archived tables found. Archive legacy tables first." });
    }

    const archiveDate = new Date(archiveLogs[0].performed_at);
    const cooldownEnd = new Date(archiveDate.getTime() + DROP_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < cooldownEnd) {
      const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      return res.status(400).json({
        error: `Cooldown period not yet expired. ${remaining} day(s) remaining until ${cooldownEnd.toISOString()}.`,
        cooldownEnd: cooldownEnd.toISOString(),
        remainingDays: remaining,
      });
    }

    const currentUser = (req as any).user;
    const dropped: string[] = [];
    const skipped: string[] = [];

    for (const table of LEGACY_TABLES) {
      const archivedName = table + ARCHIVE_SUFFIX;
      const archiveExists = getRows(await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${archivedName}') as ex`
      )))[0]?.ex === true;

      if (!archiveExists) {
        skipped.push(table);
        continue;
      }

      const rowCount = Number(getRows(await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${archivedName}"`)))[0]?.cnt ?? 0);

      await db.execute(sql.raw(`DROP TABLE "${archivedName}" CASCADE`));

      await db.execute(sql.raw(`
        INSERT INTO migration_cleanup_log (action, table_name, original_name, archived_name, row_count, performed_by_user_id, performed_by_name, reversible)
        VALUES ('DROP', '${table}', '${table}', '${archivedName}', ${rowCount}, ${currentUser.id}, '${(currentUser.name || currentUser.username).replace(/'/g, "''")}', false)
      `));

      dropped.push(table);
    }

    res.json({ success: true, dropped, skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function checkActiveReferences(): Promise<{ table: string; referenceType: string; detail: string }[]> {
  const references: { table: string; referenceType: string; detail: string }[] = [];

  for (const table of LEGACY_TABLES) {
    const exists = getRows(await db.execute(sql.raw(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') as ex`
    )))[0]?.ex === true;
    if (!exists) continue;

    const fkRefs = getRows(await db.execute(sql.raw(`
      SELECT tc.table_name as referencing_table, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = '${table}'
      AND tc.table_schema = 'public'
    `)));

    for (const fk of fkRefs) {
      if (!LEGACY_TABLES.includes(fk.referencing_table) && !fk.referencing_table.endsWith(ARCHIVE_SUFFIX)) {
        references.push({
          table,
          referenceType: "FOREIGN_KEY",
          detail: `Table "${fk.referencing_table}" column "${fk.column_name}" references "${table}"`,
        });
      }
    }
  }

  return references;
}

export function registerMigrationFinalizeRoutes(app: any) {
  app.use(router);
}
