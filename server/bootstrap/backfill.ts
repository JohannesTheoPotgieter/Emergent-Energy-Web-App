import { db } from "../db";
import { sql } from "drizzle-orm";

export async function backfillPmUserIds(log: (message: string, source?: string) => void, allowRuntimeSchemaRepair: boolean) {
  try {
    if (allowRuntimeSchemaRepair) {
      await db.execute(sql.raw(`ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_user_id INTEGER REFERENCES users(id)`));
    }

    const mappings: [string, string[]][] = [
      ["eon", ["Eon Van Rensburg", "Eon Van Rensberg"]],
      ["jt", ["JT Moorosi", "JT"]],
      ["lloyd", ["Lloyd Brown", "Lloyd"]],
      ["justin", ["Justin Franke"]],
    ];

    let totalUpdated = 0;
    for (const [username, pmNames] of mappings) {
      const pmList = pmNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
      const result = await db.execute(
        sql.raw(`UPDATE project_info SET pm_user_id = (SELECT id FROM users WHERE username = '${username}') WHERE pm = ANY(ARRAY[${pmList}])`),
      );
      totalUpdated += (result as any).rowCount || 0;
    }
    log(`Backfill pm_user_id: ${totalUpdated} rows updated`, "backfill");

    const unassignResult = await db.execute(sql.raw(`
      UPDATE operational_tasks ot
      SET owner_user_id = NULL
      FROM project_info pi
      WHERE ot.project_name = pi.project_name
        AND pi.phase IN ('Compliance Handover', 'Commercial Close Out')
        AND ot.owner_user_id IS NOT NULL
    `));
    log(`Unassign tasks for Compliance Handover / Commercial Close Out: ${((unassignResult as any).rowCount || 0)} tasks cleared`, "backfill");

    const taskResult = await db.execute(sql.raw(`
      UPDATE operational_tasks ot
      SET owner_user_id = pi.pm_user_id
      FROM project_info pi
      WHERE ot.project_name = pi.project_name
        AND pi.pm_user_id IS NOT NULL
        AND pi.phase NOT IN ('Compliance Handover', 'Commercial Close Out')
        AND (ot.owner_user_id IS NULL OR ot.owner_user_id != pi.pm_user_id)
    `));
    log(`Backfill task owner_user_id to PM: ${((taskResult as any).rowCount || 0)} tasks updated`, "backfill");
  } catch (error) {
    log(`Backfill pm_user_id error: ${error}`, "backfill");
  }
}
