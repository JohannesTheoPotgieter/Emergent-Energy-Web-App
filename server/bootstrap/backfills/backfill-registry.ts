/**
 * Backfill Registry — tracks which one-time backfills have already run
 * using the app_settings table.
 *
 * Pattern:
 *   if (await hasBackfillRun("stage_instance_v1")) return;
 *   // ... do work ...
 *   await markBackfillComplete("stage_instance_v1", { projectsBackfilled: 42 });
 *
 * Keys are stored as "backfill:<name>" in app_settings.
 * The value is a JSON object with { completedAt, ...metadata }.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";

/**
 * Check whether a named backfill has already completed.
 */
export async function hasBackfillRun(name: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql.raw(`SELECT value FROM app_settings WHERE key = 'backfill:${name.replace(/'/g, "''")}' LIMIT 1`),
    );
    const rows = (result as any).rows ?? [];
    return rows.length > 0;
  } catch {
    return false; // Table may not exist yet during early startup
  }
}

/**
 * Mark a named backfill as complete. Stores timestamp and optional metadata.
 * Idempotent — safe to call multiple times.
 */
export async function markBackfillComplete(
  name: string,
  metadata?: Record<string, any>,
): Promise<void> {
  const value = JSON.stringify({
    completedAt: new Date().toISOString(),
    ...metadata,
  }).replace(/'/g, "''");

  const key = `backfill:${name.replace(/'/g, "''")}`;

  await db.execute(sql.raw(`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES ('${key}', '${value}', 'system:backfill', NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `));
}
