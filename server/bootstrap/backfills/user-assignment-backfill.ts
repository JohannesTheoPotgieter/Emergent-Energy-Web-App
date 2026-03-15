import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resolveNameToUserId } from "../../user-resolver";

export async function runUserAssignmentBackfill(log: (message: string, source?: string) => void) {
  const opRows: any[] = await db.execute(sql.raw(`SELECT id, assignees, assignee_user_ids FROM operational_tasks WHERE array_length(assignees, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
  let opFixed = 0;
  for (const row of opRows) {
    const names: string[] = row.assignees || [];
    const existingIds: number[] = row.assignee_user_ids || [];
    const existingSet = new Set(existingIds);
    const newIds = [...existingIds];
    for (const name of names) {
      const resolved = await resolveNameToUserId(name);
      if (resolved && !existingSet.has(resolved)) {
        newIds.push(resolved);
        existingSet.add(resolved);
      }
    }
    if (newIds.length > existingIds.length) {
      const rowId = Number(row.id);
      const safeIds = newIds.filter((id) => Number.isInteger(id));
      if (!Number.isInteger(rowId) || safeIds.length === 0) continue;
      await db.execute(sql`UPDATE operational_tasks SET assignee_user_ids = ${safeIds} WHERE id = ${rowId}`);
      opFixed++;
    }
  }

  const trRows: any[] = await db.execute(sql.raw(`SELECT id, owners, owner_user_ids FROM tr_items WHERE array_length(owners, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
  let trFixed = 0;
  for (const row of trRows) {
    const names: string[] = row.owners || [];
    const existingIds: number[] = row.owner_user_ids || [];
    const existingSet = new Set(existingIds);
    const newIds = [...existingIds];
    for (const name of names) {
      const resolved = await resolveNameToUserId(name);
      if (resolved && !existingSet.has(resolved)) {
        newIds.push(resolved);
        existingSet.add(resolved);
      }
    }
    if (newIds.length > existingIds.length) {
      const rowId = Number(row.id);
      const safeIds = newIds.filter((id) => Number.isInteger(id));
      if (!Number.isInteger(rowId) || safeIds.length === 0) continue;
      await db.execute(sql`UPDATE tr_items SET owner_user_ids = ${safeIds} WHERE id = ${rowId}`);
      trFixed++;
    }
  }

  if (opFixed > 0 || trFixed > 0) {
    log(`[Backfill] Synced user IDs: ${opFixed} operational tasks, ${trFixed} TR items`, "Startup:Backfill");
  }
}
