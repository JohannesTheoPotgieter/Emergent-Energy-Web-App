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
 *
 * In production, drizzle-kit push runs at BUILD time (see .replit deployment
 * config) so the schema is synced before the server starts. This avoids
 * blocking the HTTP port during startup. The additive ALTER TABLE statements
 * in runAdditiveSchemaAlignments() handle any remaining column additions at
 * runtime without needing drizzle-kit.
 */
async function runDrizzleSchemaSync(log: (message: string, source?: string) => void) {
  const mode = getDbMode();
  if (mode !== "postgres") return;
  if (!process.env.DATABASE_URL) return;

  // In production/staging, schema sync runs at build time — skip at startup
  const isProd = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
  if (isProd) {
    log("drizzle-kit push skipped — runs at build time in production", "Startup:Schema");
    return;
  }

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

  // ── Foundation tables that other tables reference via foreign keys ──
  await safeExec("users table", `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      department TEXT,
      microsoft_id TEXT UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("clients table", `
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      short_code TEXT,
      type TEXT,
      legal_entity TEXT,
      primary_contact_name TEXT,
      primary_contact_email TEXT,
      primary_contact_phone TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("counterparties table", `
    CREATE TABLE IF NOT EXISTS counterparties (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      role_tags TEXT[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("project_info table", `
    CREATE TABLE IF NOT EXISTS project_info (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      size_kwp NUMERIC(15,2),
      pd TEXT,
      pm TEXT,
      contract_value NUMERIC(15,2),
      canonical_project_id INTEGER,
      client_id INTEGER REFERENCES clients(id),
      pm_user_id INTEGER,
      pd_user_id INTEGER,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("role_permissions table", `
    CREATE TABLE IF NOT EXISTS role_permissions (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      allowed BOOLEAN NOT NULL DEFAULT true,
      scope TEXT,
      authority_model JSONB,
      permission_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("app_settings table", `
    CREATE TABLE IF NOT EXISTS app_settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_by TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("upload_metadata table", `
    CREATE TABLE IF NOT EXISTS upload_metadata (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      upload_date TIMESTAMP NOT NULL DEFAULT NOW(),
      row_count INTEGER,
      status TEXT
    );
  `);

  await safeExec("smart_import_runs table", `
    CREATE TABLE IF NOT EXISTS smart_import_runs (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      file_name TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      row_count INTEGER,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      committed_at TIMESTAMP
    );
  `);

  await safeExec("work_items table", `
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES project_info(id),
      title TEXT NOT NULL,
      description TEXT,
      type TEXT,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      workstream TEXT,
      source TEXT,
      wbs_code TEXT,
      start_date TEXT,
      end_date TEXT,
      duration INTEGER,
      actual_start TEXT,
      actual_end TEXT,
      actual_duration INTEGER,
      percent_complete INTEGER DEFAULT 0,
      owner_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
  `);

  // ── Financial tables ──
  await safeExec("program_expense table", `
    CREATE TABLE IF NOT EXISTS program_expense (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      amount NUMERIC(15,2),
      date TEXT,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await safeExec("program_inflows table", `
    CREATE TABLE IF NOT EXISTS program_inflows (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      amount NUMERIC(15,2),
      date TEXT,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await safeExec("normalized_cost_lines table", `
    CREATE TABLE IF NOT EXISTS normalized_cost_lines (
      id SERIAL PRIMARY KEY,
      project_name TEXT,
      project_id INTEGER REFERENCES project_info(id),
      description TEXT,
      amount NUMERIC(15,2),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await safeExec("normalized_revenue_lines table", `
    CREATE TABLE IF NOT EXISTS normalized_revenue_lines (
      id SERIAL PRIMARY KEY,
      project_name TEXT,
      project_id INTEGER REFERENCES project_info(id),
      description TEXT,
      amount NUMERIC(15,2),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await safeExec("project_plan table", `
    CREATE TABLE IF NOT EXISTS project_plan (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      task_name TEXT,
      start_date TEXT,
      end_date TEXT,
      duration_days INTEGER,
      status TEXT,
      pct_complete INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("cashflow_points table", `
    CREATE TABLE IF NOT EXISTS cashflow_points (
      id SERIAL PRIMARY KEY,
      project_name TEXT,
      project_id INTEGER REFERENCES project_info(id),
      date TEXT,
      amount NUMERIC(15,2),
      type TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("project_revenue_summary table", `
    CREATE TABLE IF NOT EXISTS project_revenue_summary (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      project_id INTEGER,
      total_revenue NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Critical tables that must exist for core app functionality ──
  await safeExec("project_execution_state table", `
    CREATE TABLE IF NOT EXISTS project_execution_state (
      id SERIAL PRIMARY KEY,
      project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      phase TEXT,
      phase_updated_at TIMESTAMP,
      phase_updated_by_user_id INTEGER REFERENCES users(id),
      phase_notes TEXT,
      pd_handover_date TEXT,
      construction_start_date TEXT,
      commissioning_date TEXT,
      om_handover_date TEXT,
      client_handover_date TEXT,
      construction_start_actual TEXT,
      pd_handover_actual TEXT,
      commissioning_actual TEXT,
      client_handover_actual TEXT,
      escalation_level TEXT,
      rag_status TEXT,
      rag_comment TEXT,
      rag_updated_at TIMESTAMP,
      rag_updated_by_user_id INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT true,
      archived_status TEXT NOT NULL DEFAULT 'ACTIVE',
      execution_enabled BOOLEAN NOT NULL DEFAULT false,
      execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE',
      execution_gate_reason TEXT,
      execution_phase TEXT,
      signed_status TEXT NOT NULL DEFAULT 'NONE',
      signed_date TEXT,
      signed_document_link TEXT,
      cp_signed BOOLEAN NOT NULL DEFAULT false,
      cp_signed_date TEXT,
      cp_signed_by_user_id INTEGER REFERENCES users(id),
      cp_evidence_type TEXT,
      cp_evidence_ref TEXT,
      pm_task_pack_created BOOLEAN NOT NULL DEFAULT false,
      eng_post_cp_task_pack_created BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("dashboard metrics tables", `
    CREATE TABLE IF NOT EXISTS dashboard_project_metrics (
      id SERIAL PRIMARY KEY,
      project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      total_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
      received_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
      outstanding_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      paid_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      outstanding_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      margin_pct DECIMAL(8,4),
      task_count INTEGER NOT NULL DEFAULT 0,
      tasks_completed INTEGER NOT NULL DEFAULT 0,
      tasks_in_progress INTEGER NOT NULL DEFAULT 0,
      tasks_overdue INTEGER NOT NULL DEFAULT 0,
      tasks_active INTEGER NOT NULL DEFAULT 0,
      open_warnings INTEGER NOT NULL DEFAULT 0,
      qc_progress_pct DECIMAL(8,4),
      health_score DECIMAL(5,2),
      phase TEXT,
      rag_status TEXT,
      contract_value DECIMAL(15,2),
      project_name TEXT,
      pm TEXT,
      pd TEXT,
      last_refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS dashboard_program_metrics (
      id SERIAL PRIMARY KEY,
      total_projects INTEGER NOT NULL DEFAULT 0,
      active_projects INTEGER NOT NULL DEFAULT 0,
      total_program_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_program_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      received_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
      paid_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      avg_margin DECIMAL(8,4),
      projects_at_risk INTEGER NOT NULL DEFAULT 0,
      total_tasks_overdue INTEGER NOT NULL DEFAULT 0,
      total_open_warnings INTEGER NOT NULL DEFAULT 0,
      last_refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── dashboard_project_metrics columns (align old table shape with Drizzle schema) ──
  await safeExec("dashboard_project_metrics columns", `
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS total_cost DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS paid_cost DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS outstanding_cost DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS margin_pct DECIMAL(8,4);
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS task_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS tasks_completed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS tasks_in_progress INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS tasks_overdue INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS tasks_active INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS open_warnings INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS qc_progress_pct DECIMAL(8,4);
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS health_score DECIMAL(5,2);
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS project_name TEXT;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS pm TEXT;
    ALTER TABLE dashboard_project_metrics ADD COLUMN IF NOT EXISTS pd TEXT;
  `);

  // ── dashboard_program_metrics columns (align old table shape with Drizzle schema) ──
  await safeExec("dashboard_program_metrics columns", `
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS total_program_cost DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS received_revenue DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS paid_cost DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS avg_margin DECIMAL(8,4);
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS projects_at_risk INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS total_tasks_overdue INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dashboard_program_metrics ADD COLUMN IF NOT EXISTS total_open_warnings INTEGER NOT NULL DEFAULT 0;
  `);

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

  // ── Deliverables table (required by execution dashboard / platform summary) ──
  await safeExec("deliverables table", `
    CREATE TABLE IF NOT EXISTS deliverables (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id),
      project_name TEXT NOT NULL,
      deliverable_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      phase TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      reviewer_user_id INTEGER REFERENCES users(id),
      qc_reviewer_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'TO DO',
      current_version INTEGER NOT NULL DEFAULT 1,
      sharepoint_folder_site_id TEXT,
      sharepoint_folder_drive_id TEXT,
      sharepoint_folder_item_id TEXT,
      linked_plan_item_id INTEGER,
      linked_quality_item_instance_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      scheduled_date TEXT,
      scheduled_start_time TEXT,
      scheduled_end_time TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deliverables_project_status ON deliverables(project_id, status);
  `);

  // ── Audit events table ──
  await safeExec("audit_events table", `
    CREATE TABLE IF NOT EXISTS audit_events (
      id SERIAL PRIMARY KEY,
      actor_role TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      source TEXT NOT NULL DEFAULT 'UI',
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      changes_json TEXT,
      project_name TEXT,
      correlation_id TEXT,
      ip_address TEXT,
      request_path TEXT,
      request_method TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_name, created_at);
  `);

  // ── Project phase history table ──
  await safeExec("project_phase_history table", `
    CREATE TABLE IF NOT EXISTS project_phase_history (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      from_phase TEXT,
      to_phase TEXT NOT NULL,
      changed_by_user_id INTEGER NOT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      reason TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_phase_history_project ON project_phase_history(project_id, changed_at);
  `);

  // ── PD → PM Handover table (required by /api/projects-summary) ──
  await safeExec("project_pd_pm_handover table", `
    CREATE TABLE IF NOT EXISTS project_pd_pm_handover (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE REFERENCES project_info(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      handover_status_text TEXT,
      pd_owner TEXT,
      pm_owner TEXT,
      summary TEXT,
      risks TEXT,
      assumptions TEXT,
      feasibility_status TEXT,
      feasibility_notes TEXT,
      dependency_summary TEXT,
      handover_readiness_status TEXT,
      handover_readiness_notes TEXT,
      engineering_status TEXT,
      quality_status TEXT,
      notes_to_pm TEXT,
      handover_summary TEXT,
      deliverables JSONB NOT NULL DEFAULT '{}',
      submitted_by TEXT,
      submitted_at TIMESTAMP,
      accepted_by TEXT,
      accepted_at TIMESTAMP,
      rejected_by TEXT,
      rejected_at TIMESTAMP,
      rejection_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Approvals table (required by /api/execution-dashboard) ──
  await safeExec("approvals table", `
    DO $$ BEGIN CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE IF NOT EXISTS approvals (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status approval_status NOT NULL DEFAULT 'pending',
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      decided_by INTEGER REFERENCES users(id),
      decided_at TIMESTAMP,
      decision_note TEXT,
      token TEXT,
      expires_at TIMESTAMP,
      related_entity_type TEXT,
      related_entity_id INTEGER,
      assigned_approver INTEGER REFERENCES users(id),
      due_date TIMESTAMP,
      project_id INTEGER NOT NULL REFERENCES project_info(id),
      approval_category TEXT
    );
  `);

  // ── QC Warning table (required by /api/execution-dashboard) ──
  await safeExec("qc_warning table", `
    CREATE TABLE IF NOT EXISTS qc_warning (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      project_id INTEGER REFERENCES project_info(id),
      severity TEXT NOT NULL DEFAULT 'Medium',
      warning_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      related_plan_item_id INTEGER,
      related_item_instance_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      owner_user_id INTEGER,
      due_date TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS qc_warning_event (
      id SERIAL PRIMARY KEY,
      warning_id INTEGER NOT NULL REFERENCES qc_warning(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      note TEXT,
      actor_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Support tickets table ──
  await safeExec("support_tickets table", `
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      summary TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      current_route TEXT,
      user_agent TEXT,
      correlation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
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

  // Auto-enable data seeding if PostgreSQL is detected and project_info is empty
  let effectiveDataSeedEnabled = startupDataSeedEnabled;
  if (!effectiveDataSeedEnabled && getDbMode() === "postgres") {
    try {
      const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM project_info`));
      const count = parseInt(String((countResult as any).rows?.[0]?.cnt ?? "0"), 10);
      if (count === 0) {
        log("PostgreSQL project_info is empty — auto-enabling data seed migration", "Startup:DataSeed");
        effectiveDataSeedEnabled = true;
      }
    } catch (err: any) {
      log(`Could not check project_info count (${err.message}) — auto-enabling data seed`, "Startup:DataSeed");
      effectiveDataSeedEnabled = true;
    }
  }
  await runStartupSeeds({ startupDataSeedEnabled: effectiveDataSeedEnabled, allowStartupMutations: effectiveDataSeedEnabled || allowStartupMutations, log });
  report.seeds.push(effectiveDataSeedEnabled ? "completed" : "skipped");

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
