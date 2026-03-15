import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getAssignableUsers, getAllUsers } from "../../user-resolver";

export async function runMsAssignmentCleanup(log: (message: string, source?: string) => void) {
  const assignable = await getAssignableUsers();
  const assignableIds = new Set(assignable.map((u) => u.id));
  const allU = await getAllUsers();
  const nonMsIds = allU.filter((u) => !assignableIds.has(u.id)).map((u) => u.id);
  if (nonMsIds.length > 0 && assignable.length === 0) {
    log(`[MS-Filter] No MS-linked users yet — skipping assignment cleanup (${nonMsIds.length} non-MS users)`, "Startup:Backfill");
    return;
  }

  if (nonMsIds.length === 0) return;

  let opCleared = 0;
  let trCleared = 0;
  const opRows2: any[] = await db.execute(sql.raw(`SELECT id, assignee_user_ids FROM operational_tasks WHERE array_length(assignee_user_ids, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
  for (const row of opRows2) {
    const ids: number[] = row.assignee_user_ids || [];
    const filtered = ids.filter((id: number) => assignableIds.has(id));
    if (filtered.length !== ids.length) {
      const rowId = Number(row.id);
      if (!Number.isInteger(rowId)) continue;
      await db.execute(sql`UPDATE operational_tasks SET assignee_user_ids = ${filtered.length > 0 ? filtered : sql`'{}'::integer[]`} WHERE id = ${rowId}`);
      opCleared++;
    }
  }

  const trRows2: any[] = await db.execute(sql.raw(`SELECT id, owner_user_ids FROM tr_items WHERE array_length(owner_user_ids, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
  for (const row of trRows2) {
    const ids: number[] = row.owner_user_ids || [];
    const filtered = ids.filter((id: number) => assignableIds.has(id));
    if (filtered.length !== ids.length) {
      const rowId = Number(row.id);
      if (!Number.isInteger(rowId)) continue;
      await db.execute(sql`UPDATE tr_items SET owner_user_ids = ${filtered.length > 0 ? filtered : sql`'{}'::integer[]`} WHERE id = ${rowId}`);
      trCleared++;
    }
  }

  if (opCleared > 0 || trCleared > 0) {
    log(`[MS-Filter] Cleared non-MS-linked assignments: ${opCleared} operational tasks, ${trCleared} TR items`, "Startup:Backfill");
  }
}
