import { db } from "../db";
import { sql } from "drizzle-orm";

export async function runGuardedStartupMaintenance(options: {
  enabled: boolean;
  schemaRepairEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { enabled, schemaRepairEnabled, log } = options;
  if (!enabled || !schemaRepairEnabled) return;

  // Temporary runtime compatibility boundary (explicitly guarded by startup maintenance mode).
  // Business-table DDL should continue moving into SQL migrations.
  try {
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS sharepoint_folder_path TEXT`));
    await db.execute(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS no_revenue_linked BOOLEAN DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS has_deliverable BOOLEAN NOT NULL DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS project_eng_task_id INTEGER REFERENCES project_eng_tasks(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending'`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`));
    log("Runtime compatibility maintenance completed", "startup-maintenance");
  } catch (error: any) {
    log(`Runtime compatibility maintenance failed: ${error?.message || error}`, "startup-maintenance");
  }
}
