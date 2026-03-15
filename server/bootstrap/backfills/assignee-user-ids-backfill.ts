import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getAllUsers, resolveNameToUserId } from "../../user-resolver";

export async function runAssigneeUserIdsBackfill(log: (message: string, source?: string) => void) {
  await getAllUsers();

  async function resolveNamesForBackfill(names: string[]): Promise<number[]> {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const n of names) {
      if (!n || !n.trim()) continue;
      const uid = await resolveNameToUserId(n);
      if (uid && !seen.has(uid)) {
        ids.push(uid);
        seen.add(uid);
      }
    }
    return ids;
  }

  let otUpdated = 0;
  let otOffset = 0;
  while (true) {
    const otRows = await db.execute(sql.raw(`
      SELECT id, assignees FROM operational_tasks
      WHERE assignees IS NOT NULL AND array_length(assignees, 1) > 0
        AND (assignee_user_ids IS NULL OR array_length(assignee_user_ids, 1) = 0 OR array_length(assignee_user_ids, 1) IS NULL)
      ORDER BY id LIMIT 200 OFFSET ${otOffset}
    `));
    const rows = (otRows as any).rows || [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const ids = await resolveNamesForBackfill(row.assignees || []);
      if (ids.length > 0) {
        const idsStr = `{${ids.join(",")}}`;
        await db.execute(sql.raw(`UPDATE operational_tasks SET assignee_user_ids = '${idsStr}'::integer[] WHERE id = ${row.id}`));
        otUpdated++;
      }
    }
    if (rows.length < 200) break;
    otOffset += 200;
  }

  let trUpdated = 0;
  let trOffset = 0;
  while (true) {
    const trRows = await db.execute(sql.raw(`
      SELECT id, owners FROM tr_items
      WHERE owners IS NOT NULL AND array_length(owners, 1) > 0
        AND (owner_user_ids IS NULL OR array_length(owner_user_ids, 1) = 0 OR array_length(owner_user_ids, 1) IS NULL)
      ORDER BY id LIMIT 200 OFFSET ${trOffset}
    `));
    const rows = (trRows as any).rows || [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const ids = await resolveNamesForBackfill(row.owners || []);
      if (ids.length > 0) {
        const idsStr = `{${ids.join(",")}}`;
        await db.execute(sql.raw(`UPDATE tr_items SET owner_user_ids = '${idsStr}'::integer[] WHERE id = ${row.id}`));
        trUpdated++;
      }
    }
    if (rows.length < 200) break;
    trOffset += 200;
  }

  if (otUpdated > 0 || trUpdated > 0) {
    log(`[Backfill] assignee_user_ids: ${otUpdated} operational_tasks, ${trUpdated} tr_items updated`, "Startup:Backfill");
  }
}
