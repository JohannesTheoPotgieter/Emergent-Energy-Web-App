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

      -- Task Management & Standup System (additive)
      DO $$ BEGIN CREATE TYPE task_tag_category AS ENUM ('BUG', 'IMPROVEMENT', 'FEATURE', 'CUSTOM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE TYPE standup_cadence AS ENUM ('DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'WEEKLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE TYPE standup_mood AS ENUM ('great', 'good', 'okay', 'struggling', 'blocked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS standup_schedules (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        team_label TEXT,
        project_id INTEGER REFERENCES project_info(id),
        cadence standup_cadence NOT NULL DEFAULT 'EVERY_2_DAYS',
        cadence_days INTEGER NOT NULL DEFAULT 2,
        anchor_date TEXT NOT NULL,
        deadline_time TEXT DEFAULT '10:00',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS standup_participants (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER NOT NULL REFERENCES standup_schedules(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        is_required BOOLEAN NOT NULL DEFAULT true,
        added_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS standup_entries (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER NOT NULL REFERENCES standup_schedules(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        standup_date TEXT NOT NULL,
        what_i_did TEXT,
        what_im_doing TEXT,
        blockers TEXT,
        mood standup_mood,
        is_late BOOLEAN NOT NULL DEFAULT false,
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS task_tags (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1',
        category task_tag_category NOT NULL DEFAULT 'CUSTOM',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS work_item_tags (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT work_item_tags_unique UNIQUE (work_item_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS task_time_entries (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        duration_minutes INTEGER NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Permission system: user overrides + audit log
      ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS permission_version INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT true,
        scope TEXT,
        granted_by INTEGER REFERENCES users(id),
        reason TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT upo_unique_user_entity_action UNIQUE (user_id, entity, action)
      );
      CREATE INDEX IF NOT EXISTS idx_upo_user_id ON user_permission_overrides(user_id);

      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        target_role TEXT,
        target_user_id INTEGER,
        changed_by_user_id INTEGER REFERENCES users(id),
        changed_by_role TEXT,
        change_detail JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pal_event_type ON permission_audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_pal_target_role ON permission_audit_log(target_role);

      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_category TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_days_of_week TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_end_date TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER;

      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS data_source TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS data_source TEXT;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      ALTER TABLE project_revenue_summary ADD COLUMN IF NOT EXISTS project_id INTEGER;

      INSERT INTO task_tags (name, color, category) VALUES
        ('Bug', '#ef4444', 'BUG'),
        ('Improvement', '#f59e0b', 'IMPROVEMENT'),
        ('Feature', '#22c55e', 'FEATURE'),
        ('Security', '#dc2626', 'CUSTOM'),
        ('Performance', '#8b5cf6', 'CUSTOM'),
        ('UX', '#06b6d4', 'CUSTOM'),
        ('Tech Debt', '#64748b', 'CUSTOM'),
        ('Critical', '#dc2626', 'CUSTOM'),
        ('High Priority', '#f97316', 'CUSTOM'),
        ('Low Priority', '#94a3b8', 'CUSTOM')
      ON CONFLICT (name) DO NOTHING;

      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES project_info(id);

      -- Smart-Import: program_expense budget + actual columns
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_qty NUMERIC(12,4);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_rate_unit NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_total NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_cos_total NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_qty NUMERIC(12,4);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_rate_unit NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_actual_total NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_po_number TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoice_number TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoiced_date TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_confirmed BOOLEAN DEFAULT FALSE;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_font_color TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_payment_date TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_confirmed BOOLEAN DEFAULT FALSE;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_font_color TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS actual_cos_total NUMERIC(15,2);
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS line_status TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_line_hash TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_state TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_forecast_payment_date TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS supplier_name TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

      -- Normalized cost/revenue lines: sub_project_name + budget fields
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_qty TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_rate TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_total TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_cos TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS revenue_recognition_amount TEXT;
      ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
      ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sub_project_name TEXT;

      -- Smart-Import: program_inflows columns
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS project_id INTEGER;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

      -- FYE Revenue Tracking tables
      CREATE TABLE IF NOT EXISTS fye_budgets (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES project_info(id),
        project_name TEXT NOT NULL,
        fye TEXT NOT NULL,
        month_key TEXT NOT NULL,
        budget_type TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS forecast_pipeline (
        id SERIAL PRIMARY KEY,
        project_name TEXT NOT NULL,
        project_developer TEXT,
        location TEXT,
        size_kwp DECIMAL(12,2),
        deal_probability_pct INTEGER NOT NULL DEFAULT 75,
        forecast_signature_date TEXT,
        solar_revenue DECIMAL(15,2) DEFAULT 0,
        bess_revenue DECIMAL(15,2) DEFAULT 0,
        forecast_gp_pct DECIMAL(6,4) DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS lost_deals (
        id SERIAL PRIMARY KEY,
        deal_name TEXT NOT NULL,
        deal_value DECIMAL(15,2),
        business_developer TEXT,
        lost_reason TEXT,
        lost_date TEXT,
        notes TEXT,
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
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
