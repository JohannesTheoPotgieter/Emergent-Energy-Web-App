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
import { execSync } from "child_process";

/**
 * In development mode with PostgreSQL, run drizzle-kit push to auto-create
 * all tables from the Drizzle schema. This ensures 100% schema coverage
 * without manually maintaining DDL for every table.
 */
async function runDrizzleSchemaSync(log: (message: string, source?: string) => void) {
  const mode = getDbMode();
  if (mode !== "postgres") return;
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") return;
  if (!process.env.DATABASE_URL) return;

  try {
    log("Running drizzle-kit push to sync schema with database...", "Startup:Schema");
    execSync("npx drizzle-kit push --force", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
      env: { ...process.env },
    });
    log("drizzle-kit push completed — all schema tables synced", "Startup:Schema");
  } catch (err: any) {
    // Non-fatal: the additive alignments below will handle critical tables
    const stderr = err.stderr?.toString?.() || "";
    log(`drizzle-kit push warning (non-fatal): ${stderr || err.message}`, "Startup:Schema");
  }
}

async function runAdditiveSchemaAlignments() {
  const mode = getDbMode();

  if (mode === "sqlite") {
    console.log("[Schema] Additive alignments skipped for SQLite (handled by SQLite bootstrap)");
    return;
  }

  // Helper: execute each SQL block independently so one failure doesn't abort others
  async function safeExec(label: string, rawSql: string) {
    try {
      await db.execute(sql.raw(rawSql));
    } catch (err: any) {
      console.error(`[Schema] ${label} error:`, err.message);
    }
  }

  // ── project_info columns (comprehensive – every column from Drizzle schema) ──
  await safeExec("project_info columns", `
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMP;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_updated_by_user_id INTEGER REFERENCES users(id);
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_notes TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pd_handover_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS construction_start_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS commissioning_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS om_handover_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_handover_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS escalation_level TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS construction_start_actual TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pd_handover_actual TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS commissioning_actual TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_handover_actual TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_status TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_comment TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_updated_at TIMESTAMP;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_updated_by_user_id INTEGER;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE';
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_reason TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_status TEXT NOT NULL DEFAULT 'NONE';
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_document_link TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_phase TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS excel_tracker_link TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS canonical_project_id INTEGER;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS archived_status TEXT NOT NULL DEFAULT 'ACTIVE';
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_user_id INTEGER;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pd_user_id INTEGER;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_date TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_by_user_id INTEGER REFERENCES users(id);
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_type TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_ref TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_task_pack_created BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS eng_post_cp_task_pack_created BOOLEAN NOT NULL DEFAULT false;
  `);

  // ── Core table column additions ──
  await safeExec("core table columns", `
    ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS authority_model JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS role_tags TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE qc_item_evidence ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES project_info(id) ON DELETE CASCADE;
  `);

  // ── Entity assignments ──
  await safeExec("entity assignments", `
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
  `);

  // ── Task Management & Standup System ──
  await safeExec("task management tables", `
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
  `);

  // ── Permission system ──
  await safeExec("permission system", `
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
  `);

  // ── work_items columns ──
  await safeExec("work_items columns", `
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_category TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_days_of_week TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_end_date TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS hold_reason TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocked_type TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_deliverable_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS tracking_rag TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_type_tag TEXT;
    ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
  `);

  // ── program_expense / inflows / revenue columns ──
  await safeExec("financial table columns", `
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS data_source TEXT;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
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
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS data_source TEXT;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE project_revenue_summary ADD COLUMN IF NOT EXISTS project_id INTEGER;
  `);

  // ── normalized cost/revenue lines ──
  await safeExec("normalized lines columns", `
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES project_info(id);
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_qty TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_rate TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_total TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_cos TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS revenue_recognition_amount TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
  `);

  // ── engineering task columns ──
  await safeExec("engineering task columns", `
    ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id);
  `);

  // ── Drop FK constraints on task supporting tables (legacy operational_tasks cleanup) ──
  await safeExec("task FK cleanup", `
    DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (
        SELECT conname, conrelid::regclass AS tbl
        FROM pg_constraint
        WHERE contype = 'f'
          AND confrelid IN (
            SELECT oid FROM pg_class WHERE relname = 'operational_tasks'
          )
          AND conrelid::regclass::text IN (
            'task_comments', 'task_checklists', 'task_attachments',
            'task_deliverables', 'task_activity_log', 'task_watchers'
          )
      ) LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
      END LOOP;
    END $$;
  `);

  // ── Seed task tags ──
  await safeExec("task tags seed", `
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
  `);

  // ── FYE Revenue Tracking tables ──
  await safeExec("FYE tables", `
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
      fye_year INTEGER NOT NULL DEFAULT 2026,
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
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE forecast_pipeline ADD COLUMN IF NOT EXISTS fye_year INTEGER NOT NULL DEFAULT 2026;
    ALTER TABLE forecast_pipeline ADD COLUMN IF NOT EXISTS created_by INTEGER;
    CREATE TABLE IF NOT EXISTS lost_deals (
      id SERIAL PRIMARY KEY,
      fye_year INTEGER NOT NULL DEFAULT 2026,
      deal_name TEXT NOT NULL,
      deal_value DECIMAL(15,2),
      business_developer TEXT,
      lost_reason TEXT,
      lost_date TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE lost_deals ADD COLUMN IF NOT EXISTS fye_year INTEGER NOT NULL DEFAULT 2026;
    ALTER TABLE lost_deals ADD COLUMN IF NOT EXISTS created_by INTEGER;
  `);

  // ── Microsoft Sync tables ──
  await safeExec("MS sync tables", `
    DO $$ BEGIN CREATE TYPE ms_account_status AS ENUM ('active', 'disconnected', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE ms_object_type AS ENUM ('email', 'event', 'teams', 'sharepoint_file'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS ms_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      ms_user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      refresh_token_encrypted TEXT,
      sso_access_token TEXT,
      sso_token_expires_at TIMESTAMP,
      connected_at TIMESTAMP DEFAULT NOW(),
      status ms_account_status DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS ms_objects (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type ms_object_type NOT NULL,
      ms_id TEXT NOT NULL,
      subject_or_title TEXT,
      preview TEXT,
      web_link TEXT,
      sender_or_organizer TEXT,
      received_or_start_datetime TIMESTAMP,
      end_datetime TIMESTAMP,
      last_synced_at TIMESTAMP DEFAULT NOW(),
      action_required BOOLEAN DEFAULT false,
      is_read BOOLEAN DEFAULT true,
      importance TEXT,
      linked_project_id INTEGER,
      linked_task_id INTEGER,
      metadata JSONB,
      dismissed BOOLEAN DEFAULT false
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ms_objects_user_type_msid ON ms_objects(user_id, type, ms_id);

    CREATE TABLE IF NOT EXISTS project_links (
      id SERIAL PRIMARY KEY,
      ms_object_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      linked_by_user_id INTEGER NOT NULL,
      linked_at TIMESTAMP DEFAULT NOW(),
      note TEXT
    );
  `);

  // ── FYE KPI + Report Snapshots ──
  await safeExec("FYE KPI tables", `
    CREATE TABLE IF NOT EXISTS fye_kpi_counters (
      id SERIAL PRIMARY KEY,
      fye_year INTEGER NOT NULL UNIQUE,
      brought_in INTEGER NOT NULL DEFAULT 0,
      signed INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fye_report_snapshots (
      id SERIAL PRIMARY KEY,
      fye_year INTEGER NOT NULL,
      snapshot_month INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      snapshot_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      snapshot_data TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      submitted_by INTEGER,
      submitted_at TIMESTAMP,
      approved_by INTEGER,
      approved_at TIMESTAMP
    );
  `);

  console.log("[Schema] Additive alignments completed");
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

  await runDrizzleSchemaSync(log);
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
