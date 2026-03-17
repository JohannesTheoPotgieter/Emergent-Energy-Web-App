import type { Express } from "express";
import type { Server } from "http";
import { registerAllRoutes } from "../routes/register-all-routes";
import { runStartupBackfills } from "./run-startup-backfills";
import { runStartupSeeds } from "./run-startup-seeds";
import { runStartupMaintenanceOrchestrator } from "./startup-maintenance-orchestrator";
import { startRuntimeServices } from "./start-runtime-services";
import type { StartupReport } from "./startup-report";
import { db, getDbMode } from "../db";
import { sql } from "drizzle-orm";

async function runAdditiveSchemaAlignments() {
  const mode = getDbMode();

  if (mode === "sqlite") {
    console.log("[Schema] Additive alignments skipped for SQLite (handled by SQLite bootstrap)");
    return;
  }

  try {
    await db.execute(sql.raw(`
      ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS authority_model JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS role_tags TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE qc_item_evidence ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES project_info(id) ON DELETE CASCADE;
      DO $$ BEGIN CREATE TYPE entity_assignment_role AS ENUM ('OWNER','ASSIGNEE','APPROVER','REVIEWER','VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE TYPE assignee_type AS ENUM ('internal_user','external_counterparty','external_contact'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS entity_assignments (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        project_id INTEGER REFERENCES project_info(id),
        assignment_role entity_assignment_role NOT NULL DEFAULT 'ASSIGNEE',
        assignee_type assignee_type NOT NULL,
        assignee_id INTEGER NOT NULL,
        display_label_snapshot TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        assigned_by_user_id INTEGER REFERENCES users(id),
        cleared_by_user_id INTEGER REFERENCES users(id),
        assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
        cleared_at TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS counterparty_contacts (
        id SERIAL PRIMARY KEY,
        counterparty_id INTEGER NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        title TEXT,
        role_tags TEXT[] NOT NULL DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_counterparty_contacts_counterparty_id ON counterparty_contacts(counterparty_id);
    `));
    console.log("[Schema] Additive alignments completed");
  } catch (err: any) {
    console.error("[Schema] Additive alignment error:", err.message);
  }
}

export async function runStartupOrchestrator(options: {
  app: Express;
  httpServer: Server;
  runtimeMaintenanceEnabled: boolean;
  startupSchemaRepairEnabled: boolean;
  startupDataSeedEnabled: boolean;
  startupBackfillEnabled: boolean;
  allowStartupMutations: boolean;
  startupSyncEnabled: boolean;
  report: StartupReport;
  log: (message: string, source?: string) => void;
}) {
  const {
    app,
    httpServer,
    runtimeMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    allowStartupMutations,
    startupSyncEnabled,
    report,
    log,
  } = options;

  await runAdditiveSchemaAlignments();

  await runStartupMaintenanceOrchestrator({ runtimeMaintenanceEnabled, startupSchemaRepairEnabled, log });
  report.maintenance.push(runtimeMaintenanceEnabled && startupSchemaRepairEnabled ? "completed" : "skipped");

  await runStartupSeeds({ startupDataSeedEnabled, allowStartupMutations, log });
  report.seeds.push(startupDataSeedEnabled ? "completed" : "skipped");

  await runStartupBackfills({
    startupBackfillEnabled,
    allowStartupMutations,
    log,
  });
  report.backfills.push(startupBackfillEnabled ? "completed" : "skipped");

  await registerAllRoutes({
    app,
    httpServer,
    log,
  });
  report.routes.push("registered");

  const runtimeServices = await startRuntimeServices({ startupBackfillEnabled, startupSyncEnabled, log });
  report.runtimeServices.push(...runtimeServices);
}
