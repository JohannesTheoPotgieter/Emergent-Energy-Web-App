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
 * SQL-based schema sync: runs pre-push-enums.sql (all enums + stub tables)
 * then full-schema-alignment.sql (all columns via ALTER TABLE ADD COLUMN IF NOT EXISTS).
 * This replaces drizzle-kit push which hangs on interactive rename prompts.
 * Uses psql when available, falls back to db.execute() for production containers.
 */
async function runDrizzleSchemaSync(log: (message: string, source?: string) => void) {
  const mode = getDbMode();
  if (mode !== "postgres") return;
  if (!process.env.DATABASE_URL) return;

  // Wait for PostgreSQL to be fully ready before running schema sync
  const ready = await waitForDbReady();
  if (!ready) {
    log("Database not accepting connections — skipping schema sync", "Startup:Schema");
    return;
  }

  const sqlFiles = [
    { name: "pre-push-enums.sql", path: "script/pre-push-enums.sql" },
    { name: "full-schema-alignment.sql", path: "script/full-schema-alignment.sql" },
  ];

  for (const file of sqlFiles) {
    // Try psql first (fastest, handles DO $$ blocks natively)
    try {
      execSync(`psql $DATABASE_URL -f ${file.path}`, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
        env: { ...process.env },
      });
      log(`${file.name} synced (psql)`, "Startup:Schema");
      continue;
    } catch (_psqlErr: any) {
      // psql not available or failed — fall back to db.execute
    }

    // Fallback: read file and execute via Drizzle
    try {
      const fs = await import("fs");
      const path = await import("path");
      const candidates = [
        path.resolve(process.cwd(), file.path),
        path.resolve(process.cwd(), `dist/${file.path}`),
        path.resolve(import.meta.dirname, `../${file.path}`),
        path.resolve(import.meta.dirname, `../../${file.path}`),
      ];
      let sqlContent: string | null = null;
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          sqlContent = fs.readFileSync(candidate, "utf8");
          break;
        }
      }
      if (!sqlContent) {
        log(`${file.name} not found in any search path, skipping`, "Startup:Schema");
        continue;
      }

      // First try executing the whole file at once
      try {
        await db.execute(sql.raw(sqlContent));
        log(`${file.name} synced (db.execute)`, "Startup:Schema");
        continue;
      } catch (_blockErr) {
        // DO $$ blocks often fail via Drizzle — fall back to statement-by-statement execution
      }

      // Second fallback: extract individual ALTER TABLE statements from DO $$ blocks and execute each one
      const alterStatements = extractAlterStatements(sqlContent);
      if (alterStatements.length > 0) {
        let applied = 0;
        let skipped = 0;
        for (const stmt of alterStatements) {
          try {
            await db.execute(sql.raw(stmt));
            applied++;
          } catch {
            skipped++; // Column likely already exists or table missing — safe to skip
          }
        }
        log(`${file.name} synced (statement-by-statement: ${applied} applied, ${skipped} skipped)`, "Startup:Schema");
      } else {
        log(`${file.name} warning: no ALTER statements extracted from DO $$ block`, "Startup:Schema");
      }
    } catch (err: unknown) {
      log(`${file.name} warning (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:Schema");
    }
  }
}

/**
 * Extract individual ALTER TABLE ADD COLUMN IF NOT EXISTS statements from a DO $$ block.
 * Handles both single-column and multi-column ADD patterns:
 *   ALTER TABLE "foo" ADD COLUMN "bar" TEXT;
 *   ALTER TABLE "foo" ADD COLUMN "a" INT, ADD COLUMN "b" TEXT;
 */
function extractAlterStatements(sqlContent: string): string[] {
  const statements: string[] = [];
  // Match full ALTER TABLE ... ADD COLUMN ... lines (may contain multiple ADD COLUMNs)
  const alterLineRegex = /ALTER TABLE\s+"(\w+)"\s+(ADD COLUMN\s+.+?);/gi;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = alterLineRegex.exec(sqlContent)) !== null) {
    const table = lineMatch[1];
    const addPart = lineMatch[2];
    // Split multi-column ADD statements: ADD COLUMN "a" TYPE, ADD COLUMN "b" TYPE
    const columns = addPart.split(/,\s*ADD COLUMN\s+/i);
    for (let i = 0; i < columns.length; i++) {
      let colDef = columns[i].trim();
      if (i === 0) colDef = colDef.replace(/^ADD COLUMN\s+/i, '');
      // Strip any trailing END IF or whitespace
      colDef = colDef.replace(/\s*END\s+IF.*$/i, '').trim();
      if (colDef) {
        statements.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${colDef}`);
      }
    }
  }
  return statements;
}

async function waitForDbReady(maxRetries = 5, baseDelayMs = 1000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await db.execute(sql.raw('SELECT 1'));
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Schema] DB not ready (attempt ${attempt}/${maxRetries}): ${msg}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  return false;
}

async function runAdditiveSchemaAlignments() {
  const mode = getDbMode();

  if (mode === "sqlite") {
    console.log("[Schema] Additive alignments skipped for SQLite (handled by SQLite bootstrap)");
    return;
  }

  const ready = await waitForDbReady();
  if (!ready) {
    console.error("[Schema] Database not accepting connections after retries — skipping additive alignments");
    return;
  }

  // Helper: execute each SQL block independently so one failure doesn't abort others
  async function safeExec(label: string, rawSql: string) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await db.execute(sql.raw(rawSql));
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const pgCause = (err as any)?.cause;
        const isTransient = /connection|ECONNREFUSED|not yet accepting|timeout/i.test(msg);
        if (isTransient && attempt < 2) {
          console.warn(`[Schema] ${label} transient error, retrying in 2s: ${msg}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.error(`[Schema] ${label} error:`, msg);
        if (pgCause) console.error(`[Schema] ${label} PG cause:`, pgCause.message || pgCause);
      }
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

  // Handle legacy renamed tables — if _work_items_legacy exists but work_items doesn't
  // exist as either a TABLE or a VIEW, reassign sequence ownership.
  // In production, work_items/deliverables are VIEWS so these blocks should NOT run.
  await safeExec("legacy work_items sequence fix", `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_work_items_legacy')
         AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items')
         AND NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='work_items')
      THEN
        IF EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='work_items_id_seq') THEN
          ALTER SEQUENCE work_items_id_seq OWNED BY NONE;
          ALTER TABLE _work_items_legacy ALTER COLUMN id SET DEFAULT nextval('_work_items_legacy_id_seq'::regclass);
          BEGIN
            CREATE SEQUENCE _work_items_legacy_id_seq;
            PERFORM setval('_work_items_legacy_id_seq', (SELECT COALESCE(MAX(id),0) FROM _work_items_legacy));
            ALTER TABLE _work_items_legacy ALTER COLUMN id SET DEFAULT nextval('_work_items_legacy_id_seq'::regclass);
          EXCEPTION WHEN duplicate_table THEN NULL;
          END;
          DROP SEQUENCE IF EXISTS work_items_id_seq;
        END IF;
      END IF;
    END $$;
  `);

  await safeExec("legacy deliverables sequence fix", `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_deliverables_legacy')
         AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='deliverables')
         AND NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='deliverables')
      THEN
        IF EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='deliverables_id_seq') THEN
          ALTER SEQUENCE deliverables_id_seq OWNED BY NONE;
          BEGIN
            CREATE SEQUENCE _deliverables_legacy_id_seq;
            PERFORM setval('_deliverables_legacy_id_seq', (SELECT COALESCE(MAX(id),0) FROM _deliverables_legacy));
            ALTER TABLE _deliverables_legacy ALTER COLUMN id SET DEFAULT nextval('_deliverables_legacy_id_seq'::regclass);
          EXCEPTION WHEN duplicate_table THEN NULL;
          END;
          DROP SEQUENCE IF EXISTS deliverables_id_seq;
        END IF;
        ALTER INDEX IF EXISTS deliverables_pkey RENAME TO _deliverables_legacy_pkey;
        ALTER INDEX IF EXISTS idx_deliverables_project_status RENAME TO _idx_deliverables_legacy_project_status;
      END IF;
    END $$;
  `);

  await safeExec("legacy work_items index fix", `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_work_items_legacy')
         AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items')
         AND NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='work_items')
      THEN
        ALTER INDEX IF EXISTS work_items_pkey RENAME TO _work_items_legacy_pkey;
        ALTER INDEX IF EXISTS idx_work_items_deleted RENAME TO _idx_work_items_legacy_deleted;
        ALTER INDEX IF EXISTS idx_work_items_external_ref RENAME TO _idx_work_items_legacy_external_ref;
        ALTER INDEX IF EXISTS idx_work_items_owner RENAME TO _idx_work_items_legacy_owner;
        ALTER INDEX IF EXISTS idx_work_items_project_id RENAME TO _idx_work_items_legacy_project_id;
        ALTER INDEX IF EXISTS idx_work_items_workstream RENAME TO _idx_work_items_legacy_workstream;
        ALTER INDEX IF EXISTS work_items_external_ref_key RENAME TO _work_items_legacy_external_ref_key;
      END IF;
    END $$;
  `);

  await safeExec("work_items view insert trigger fix", `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='work_items')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname='_work_items_view_insert') THEN
        CREATE OR REPLACE FUNCTION public._work_items_view_insert()
        RETURNS trigger LANGUAGE plpgsql AS $fn$
        DECLARE
          resolved_id INTEGER;
        BEGIN
          resolved_id := COALESCE(NEW.id, nextval('work_items_id_seq'));
          INSERT INTO core.work_items (
            id, client_id, project_id, workstream, type, source, title, description,
            status, priority, start_date, end_date, duration, percent_complete,
            wbs_code, outline_number, parent_id, parent_work_item_id,
            owner_user_id, is_shared, external_ref, legacy_table, legacy_id,
            created_by, created_at, updated_at, deleted_at,
            scheduled_date, scheduled_start_time, scheduled_end_time,
            expected_pct_complete, indent_level, is_milestone, phase,
            owner_name, source_row, source_sheet, import_run_id,
            baseline_start, baseline_end, baseline_duration, task_mode,
            actual_start, actual_end, actual_duration, sort_order,
            estimate_minutes, task_category, is_recurring, recurrence_frequency,
            recurrence_interval, recurrence_days_of_week, recurrence_end_date,
            recurrence_parent_id, sub_project_name, hold_reason, blocked_type,
            approval_required, linked_plan_item_id, linked_deliverable_id,
            linked_quality_item_instance_id, completed_at, tracking_rag,
            task_type_tag, blocker_reason, pd_ticket_id, planned_hours,
            actual_hours, bucket, pinned_today, pinned_week,
            source_email_id, source_email_subject, next_step,
            definition_of_done, completion_note, source_table
          ) VALUES (
            resolved_id, NEW.client_id, NEW.project_id, NEW.workstream, NEW.type, NEW.source, NEW.title, NEW.description,
            NEW.status, NEW.priority, NEW.start_date, NEW.end_date, NEW.duration, NEW.percent_complete,
            NEW.wbs_code, NEW.outline_number, NEW.parent_id, NEW.parent_id,
            NEW.owner_user_id, COALESCE(NEW.is_shared, false), NEW.external_ref, NEW.legacy_table, NEW.legacy_id,
            NEW.created_by, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW()), NEW.deleted_at,
            NEW.scheduled_date, NEW.scheduled_start_time, NEW.scheduled_end_time,
            NEW.expected_pct_complete, NEW.indent_level, COALESCE(NEW.is_milestone, false), NEW.phase,
            NEW.owner_name, NEW.source_row, NEW.source_sheet, NEW.import_run_id,
            NEW.baseline_start, NEW.baseline_end, NEW.baseline_duration, NEW.task_mode,
            NEW.actual_start, NEW.actual_end, NEW.actual_duration, COALESCE(NEW.sort_order, 0),
            NEW.estimate_minutes, NEW.task_category, COALESCE(NEW.is_recurring, false), NEW.recurrence_frequency,
            NEW.recurrence_interval, NEW.recurrence_days_of_week, NEW.recurrence_end_date,
            NEW.recurrence_parent_id, NEW.sub_project_name, NEW.hold_reason, NEW.blocked_type,
            COALESCE(NEW.approval_required, false), NEW.linked_plan_item_id, NEW.linked_deliverable_id,
            NEW.linked_quality_item_instance_id, NEW.completed_at, NEW.tracking_rag,
            NEW.task_type_tag, NEW.blocker_reason, NEW.pd_ticket_id, NEW.planned_hours,
            NEW.actual_hours, NEW.bucket, COALESCE(NEW.pinned_today, false), COALESCE(NEW.pinned_week, false),
            NEW.source_email_id, NEW.source_email_subject, NEW.next_step,
            NEW.definition_of_done, NEW.completion_note, 'public.work_items'
          )
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status, title = EXCLUDED.title, description = EXCLUDED.description,
            priority = EXCLUDED.priority, owner_user_id = EXCLUDED.owner_user_id,
            updated_at = NOW(), deleted_at = EXCLUDED.deleted_at;
          NEW.id := resolved_id;
          IF NEW.external_ref IS NOT NULL THEN
            DELETE FROM public._work_items_legacy
            WHERE external_ref = NEW.external_ref AND id != resolved_id;
          END IF;
          INSERT INTO public._work_items_legacy (
            id, client_id, project_id, workstream, type, source, title, description,
            status, priority, start_date, end_date, duration, percent_complete,
            wbs_code, outline_number, parent_id,
            owner_user_id, is_shared, external_ref, legacy_table, legacy_id,
            created_by, created_at, updated_at, deleted_at,
            scheduled_date, scheduled_start_time, scheduled_end_time,
            expected_pct_complete, indent_level, is_milestone, phase,
            owner_name, source_row, source_sheet, import_run_id,
            baseline_start, baseline_end, baseline_duration, task_mode,
            actual_start, actual_end, actual_duration, sort_order,
            estimate_minutes, task_category, is_recurring, recurrence_frequency,
            recurrence_interval, recurrence_days_of_week, recurrence_end_date,
            recurrence_parent_id, sub_project_name, hold_reason, blocked_type,
            approval_required, linked_plan_item_id, linked_deliverable_id,
            linked_quality_item_instance_id, completed_at, tracking_rag,
            task_type_tag, blocker_reason, pd_ticket_id, planned_hours,
            actual_hours, bucket, pinned_today, pinned_week,
            source_email_id, source_email_subject, next_step,
            definition_of_done, completion_note
          ) VALUES (
            NEW.id, NEW.client_id, NEW.project_id,
            NEW.workstream::work_item_workstream, NEW.type, NEW.source::work_item_source,
            NEW.title, NEW.description,
            NEW.status, NEW.priority, NEW.start_date, NEW.end_date, NEW.duration, NEW.percent_complete,
            NEW.wbs_code, NEW.outline_number, NEW.parent_id,
            NEW.owner_user_id, COALESCE(NEW.is_shared, false), NEW.external_ref, NEW.legacy_table, NEW.legacy_id,
            NEW.created_by, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW()), NEW.deleted_at,
            NEW.scheduled_date, NEW.scheduled_start_time, NEW.scheduled_end_time,
            NEW.expected_pct_complete, NEW.indent_level, COALESCE(NEW.is_milestone, false), NEW.phase,
            NEW.owner_name, NEW.source_row, NEW.source_sheet, NEW.import_run_id,
            NEW.baseline_start, NEW.baseline_end, NEW.baseline_duration, NEW.task_mode,
            NEW.actual_start, NEW.actual_end, NEW.actual_duration, COALESCE(NEW.sort_order, 0),
            NEW.estimate_minutes, NEW.task_category, COALESCE(NEW.is_recurring, false), NEW.recurrence_frequency,
            NEW.recurrence_interval, NEW.recurrence_days_of_week, NEW.recurrence_end_date,
            NEW.recurrence_parent_id, NEW.sub_project_name, NEW.hold_reason, NEW.blocked_type,
            COALESCE(NEW.approval_required, false), NEW.linked_plan_item_id, NEW.linked_deliverable_id,
            NEW.linked_quality_item_instance_id, NEW.completed_at, NEW.tracking_rag,
            NEW.task_type_tag, NEW.blocker_reason, NEW.pd_ticket_id, NEW.planned_hours,
            NEW.actual_hours, NEW.bucket, COALESCE(NEW.pinned_today, false), COALESCE(NEW.pinned_week, false),
            NEW.source_email_id, NEW.source_email_subject, NEW.next_step,
            NEW.definition_of_done, NEW.completion_note
          )
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status, title = EXCLUDED.title, updated_at = EXCLUDED.updated_at;
          RETURN NEW;
        END;
        $fn$;
        RAISE NOTICE '[DB] Updated _work_items_view_insert trigger to auto-generate IDs';
      END IF;
    END $$;
  `);

  await safeExec("work_items view update trigger", `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='work_items')
         AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='core' AND tablename='work_items') THEN
        CREATE OR REPLACE FUNCTION public._work_items_view_update()
        RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          UPDATE core.work_items SET
            client_id = NEW.client_id,
            project_id = NEW.project_id,
            workstream = NEW.workstream,
            type = NEW.type,
            source = NEW.source,
            title = NEW.title,
            description = NEW.description,
            status = NEW.status,
            priority = NEW.priority,
            start_date = NEW.start_date,
            end_date = NEW.end_date,
            duration = NEW.duration,
            percent_complete = NEW.percent_complete,
            wbs_code = NEW.wbs_code,
            outline_number = NEW.outline_number,
            parent_id = NEW.parent_id,
            owner_user_id = NEW.owner_user_id,
            is_shared = COALESCE(NEW.is_shared, OLD.is_shared),
            external_ref = NEW.external_ref,
            legacy_table = NEW.legacy_table,
            legacy_id = NEW.legacy_id,
            updated_at = COALESCE(NEW.updated_at, NOW()),
            deleted_at = NEW.deleted_at,
            scheduled_date = NEW.scheduled_date,
            scheduled_start_time = NEW.scheduled_start_time,
            scheduled_end_time = NEW.scheduled_end_time,
            expected_pct_complete = NEW.expected_pct_complete,
            indent_level = NEW.indent_level,
            is_milestone = COALESCE(NEW.is_milestone, OLD.is_milestone),
            phase = NEW.phase,
            owner_name = NEW.owner_name,
            source_row = NEW.source_row,
            source_sheet = NEW.source_sheet,
            import_run_id = NEW.import_run_id,
            baseline_start = NEW.baseline_start,
            baseline_end = NEW.baseline_end,
            baseline_duration = NEW.baseline_duration,
            task_mode = NEW.task_mode,
            actual_start = NEW.actual_start,
            actual_end = NEW.actual_end,
            actual_duration = NEW.actual_duration,
            sort_order = COALESCE(NEW.sort_order, OLD.sort_order),
            estimate_minutes = NEW.estimate_minutes,
            task_category = NEW.task_category,
            is_recurring = COALESCE(NEW.is_recurring, OLD.is_recurring),
            recurrence_frequency = NEW.recurrence_frequency,
            recurrence_interval = NEW.recurrence_interval,
            recurrence_days_of_week = NEW.recurrence_days_of_week,
            recurrence_end_date = NEW.recurrence_end_date,
            recurrence_parent_id = NEW.recurrence_parent_id,
            sub_project_name = NEW.sub_project_name,
            hold_reason = NEW.hold_reason,
            blocked_type = NEW.blocked_type,
            approval_required = COALESCE(NEW.approval_required, OLD.approval_required),
            linked_plan_item_id = NEW.linked_plan_item_id,
            linked_deliverable_id = NEW.linked_deliverable_id,
            linked_quality_item_instance_id = NEW.linked_quality_item_instance_id,
            completed_at = NEW.completed_at,
            tracking_rag = NEW.tracking_rag,
            task_type_tag = NEW.task_type_tag,
            blocker_reason = NEW.blocker_reason,
            pd_ticket_id = NEW.pd_ticket_id,
            planned_hours = NEW.planned_hours,
            actual_hours = NEW.actual_hours,
            bucket = NEW.bucket,
            pinned_today = COALESCE(NEW.pinned_today, OLD.pinned_today),
            pinned_week = COALESCE(NEW.pinned_week, OLD.pinned_week),
            source_email_id = NEW.source_email_id,
            source_email_subject = NEW.source_email_subject,
            next_step = NEW.next_step,
            definition_of_done = NEW.definition_of_done,
            completion_note = NEW.completion_note
          WHERE id = OLD.id;

          UPDATE public._work_items_legacy SET
            status = NEW.status,
            title = NEW.title,
            description = NEW.description,
            priority = NEW.priority,
            percent_complete = NEW.percent_complete,
            start_date = NEW.start_date,
            end_date = NEW.end_date,
            duration = NEW.duration,
            owner_user_id = NEW.owner_user_id,
            owner_name = NEW.owner_name,
            phase = NEW.phase,
            actual_start = NEW.actual_start,
            actual_end = NEW.actual_end,
            actual_duration = NEW.actual_duration,
            import_run_id = NEW.import_run_id,
            updated_at = COALESCE(NEW.updated_at, NOW()),
            deleted_at = NEW.deleted_at
          WHERE id = OLD.id;

          RETURN NEW;
        END;
        $fn$;

        DROP TRIGGER IF EXISTS _work_items_view_update_trigger ON public.work_items;
        CREATE TRIGGER _work_items_view_update_trigger
          INSTEAD OF UPDATE ON public.work_items
          FOR EACH ROW EXECUTE FUNCTION public._work_items_view_update();

        RAISE NOTICE '[DB] Created _work_items_view_update trigger on work_items view';
      END IF;
    END $$;
  `);

  await safeExec("sync work_items_id_seq to max(id)", `
    DO $$
    DECLARE max_id BIGINT;
    DECLARE seq_exists BOOLEAN;
    DECLARE core_exists BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND c.relname = 'work_items_id_seq'
      ) INTO seq_exists;

      SELECT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'core' AND tablename = 'work_items'
      ) INTO core_exists;

      IF seq_exists AND core_exists THEN
        SELECT COALESCE(MAX(id), 0) INTO max_id FROM core.work_items;
        IF max_id > 0 THEN
          PERFORM setval('work_items_id_seq', max_id, true);
          RAISE NOTICE '[DB] Synced work_items_id_seq to %', max_id;
        END IF;
      ELSIF seq_exists THEN
        SELECT COALESCE(MAX(id), 0) INTO max_id FROM public.work_items;
        IF max_id > 0 THEN
          PERFORM setval('work_items_id_seq', max_id, true);
          RAISE NOTICE '[DB] Synced work_items_id_seq (from public.work_items) to %', max_id;
        END IF;
      END IF;
    END $$;
  `);

  const wiExists = await db.execute(sql.raw(
    "SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='work_items' UNION ALL SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items'"
  ));
  if (wiExists.rows.length > 0) {
    console.log("[DB] work_items already exists (table or view) — skipping creation");
  } else {
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
  }

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

  await safeExec("project_settings table", `
    CREATE TABLE IF NOT EXISTS project_settings (
      id SERIAL PRIMARY KEY,
      project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      excel_tracker_link TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
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
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS opportunity_id INTEGER REFERENCES opportunities(id);
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS delivery_model TEXT;
    ALTER TABLE project_info ADD COLUMN IF NOT EXISTS project_code TEXT;
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

  // ── project_execution_state columns added after B3/B4 enrichment ──
  await safeExec("project_execution_state columns", `
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS construction_manager_user_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS quality_lead_user_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS engineering_lead_user_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS program_manager_user_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS project_finance_user_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS matriarch_handover_target TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS practical_completion_target TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS practical_completion_actual TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS cost_baseline NUMERIC(15,2);
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS margin_baseline NUMERIC(8,4);
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS site_establishment_date TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS site_establishment_actual TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS financial_review_status TEXT NOT NULL DEFAULT 'NOT_STARTED';
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS financial_review_id INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS current_stage_code TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS gate_status TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS gate_readiness_pct INTEGER;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS waiting_on_department TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS waiting_on_user_id INTEGER REFERENCES users(id);
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS next_required_action TEXT;
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS stage_owner_user_id INTEGER REFERENCES users(id);
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS stage_approver_user_id INTEGER REFERENCES users(id);
    ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS kam_user_id INTEGER REFERENCES users(id);
  `);

  // ── users columns ──
  await safeExec("users columns", `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
  `);

  // ── clients enrichment columns ──
  await safeExec("clients columns", `
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS legal_entity_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS trading_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_entity TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_contact_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_contact_email TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS pipedrive_org_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
  `);

  // ── counterparties enrichment columns ──
  await safeExec("counterparties columns", `
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS name_canonical TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS name_aliases TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS type_default TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS vat_number TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS registration_number TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS contact_person TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_name TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_branch_code TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS payment_terms TEXT;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS created_by INTEGER;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;
  `);

  // ── approvals enrichment columns ──
  await safeExec("approvals columns", `
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approval_type TEXT;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS urgency TEXT;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS evidence_links TEXT;
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
  `);

  const wiTableForTags = await db.execute(sql.raw("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items'"));
  if (wiTableForTags.rows.length > 0) {
    await safeExec("work_item_tags table", `
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
  } else {
    console.log("[DB] work_items is not a BASE TABLE — skipping work_item_tags/task_time_entries creation");
  }

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

  // ── work_items columns (skip if work_items is a VIEW in production) ──
  const wiTableResult = await db.execute(sql.raw("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items'"));
  if (wiTableResult.rows.length > 0) {
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
  } else {
    console.log("[DB] work_items is not a BASE TABLE — skipping column additions");
  }

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
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override TEXT;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_by INTEGER REFERENCES users(id);
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_at TIMESTAMP;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_reason TEXT;
  `);

  // ── temporal/audit columns on finance tables ──
  await safeExec("finance temporal columns", `
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP DEFAULT NOW();
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'imported';
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_snapshot JSONB;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
    ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP DEFAULT NOW();
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'imported';
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_snapshot JSONB;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
    ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP DEFAULT NOW();
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'imported';
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS import_snapshot JSONB;
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
    ALTER TABLE cashflow_points ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP DEFAULT NOW();
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'imported';
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS import_snapshot JSONB;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
    ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP DEFAULT NOW();
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'imported';
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS import_snapshot JSONB;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
    ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
  `);

  // ── project_id FK additions for tables that gained them in schema refactor ──
  await safeExec("project_id FK additions", `
    ALTER TABLE milestone_task_links ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE project_editable_fields ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE project_editable_fields ADD COLUMN IF NOT EXISTS province TEXT;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS linked_project_id INTEGER;
    ALTER TABLE priority_links ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE expense_task_links ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE cos_status_overrides ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE derived_project_kpis ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE finance_cos_monthly ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE finance_revenue_monthly ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE financial_edit_requests ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE financial_integration_rules ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE forecast_pipeline ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE issue_resolution_rules ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE key_date_mappings ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE project_plan ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE project_plan_dependency ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE project_team_members ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE qc_plan_link ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE qc_postmortem ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE qc_warning ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE schedule_change_notice ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE user_project_folders ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE working_plan_scenario ADD COLUMN IF NOT EXISTS project_id INTEGER;
    ALTER TABLE writeback_mappings ADD COLUMN IF NOT EXISTS project_id INTEGER;
  `);

  // ── engineering task columns (skip FK to work_items if it's a VIEW) ──
  const wiTableForEng = await db.execute(sql.raw("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_items'"));
  if (wiTableForEng.rows.length > 0) {
    await safeExec("engineering task columns", `
      ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id);
    `);
  } else {
    await safeExec("engineering task columns (no FK)", `
      ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS work_item_id INTEGER;
    `);
  }

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
  const delExists = await db.execute(sql.raw(
    "SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='deliverables' UNION ALL SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='deliverables'"
  ));
  if (delExists.rows.length > 0) {
    console.log("[DB] deliverables already exists (table or view) — skipping creation");
  } else {
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
  }

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

  // ── Ensure project_execution_state has phase data migrated from project_info ──
  // If project_info has a phase column and project_execution_state rows are missing phase,
  // copy the phase from project_info into project_execution_state
  await safeExec("backfill phase from project_info to project_execution_state", `
    DO $$
    BEGIN
      -- Only run if project_info has a phase column (legacy schema)
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project_info' AND column_name = 'phase'
      ) THEN
        -- Insert missing execution state rows with phase from project_info
        INSERT INTO project_execution_state (project_id, phase, created_at, updated_at)
        SELECT pi.id, pi.phase, NOW(), NOW()
        FROM project_info pi
        LEFT JOIN project_execution_state pes ON pes.project_id = pi.id
        WHERE pes.id IS NULL AND pi.phase IS NOT NULL
        ON CONFLICT (project_id) DO NOTHING;

        -- Update existing rows where phase is null but project_info has it
        UPDATE project_execution_state pes
        SET phase = pi.phase, updated_at = NOW()
        FROM project_info pi
        WHERE pes.project_id = pi.id
          AND (pes.phase IS NULL OR pes.phase = '')
          AND pi.phase IS NOT NULL AND pi.phase != '';
      END IF;
    END $$;
  `);

  // ── Ensure organization_id columns are nullable for graceful removal ──
  await safeExec("make organization_id nullable", `
    DO $$
    BEGIN
      -- Make organization_id nullable on tables where it existed but was removed from Drizzle schema
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'organization_id') THEN
        ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE users ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_info' AND column_name = 'organization_id') THEN
        ALTER TABLE project_info ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE project_info ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'organization_id') THEN
        ALTER TABLE clients ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE clients ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'counterparties' AND column_name = 'organization_id') THEN
        ALTER TABLE counterparties ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE counterparties ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_project_metrics' AND column_name = 'organization_id') THEN
        ALTER TABLE dashboard_project_metrics ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE dashboard_project_metrics ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_program_metrics' AND column_name = 'organization_id') THEN
        ALTER TABLE dashboard_program_metrics ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE dashboard_program_metrics ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phase_template' AND column_name = 'organization_id') THEN
        ALTER TABLE phase_template ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE phase_template ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portfolios' AND column_name = 'organization_id') THEN
        ALTER TABLE portfolios ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE portfolios ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'qc_template' AND column_name = 'organization_id') THEN
        ALTER TABLE qc_template ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE qc_template ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'eng_stage_templates' AND column_name = 'organization_id') THEN
        ALTER TABLE eng_stage_templates ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE eng_stage_templates ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'role_credentials' AND column_name = 'organization_id') THEN
        ALTER TABLE role_credentials ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE role_credentials ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'app_settings' AND column_name = 'organization_id') THEN
        ALTER TABLE app_settings ALTER COLUMN organization_id DROP NOT NULL;
        ALTER TABLE app_settings ALTER COLUMN organization_id SET DEFAULT 1;
      END IF;
    END $$;
  `);

  // ── Priority strategic layer: priority_projects junction table ──
  await safeExec("priority_projects table", `
    CREATE TABLE IF NOT EXISTS priority_projects (
      id SERIAL PRIMARY KEY,
      priority_id INTEGER NOT NULL REFERENCES mytool_company_priorities(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      linked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(priority_id, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_priority_projects_priority_id ON priority_projects(priority_id);
    CREATE INDEX IF NOT EXISTS idx_priority_projects_project_id ON priority_projects(project_id);
  `);

  // ── Strategic layer columns on mytool_company_priorities ──
  await safeExec("priority strategic columns", `
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS accountable_exec_id INTEGER REFERENCES users(id);
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS target_start_date TEXT;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS target_outcome TEXT;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS manual_health TEXT;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS manual_progress INTEGER;
  `);

  // ── Priority derived metrics VIEW ──
  await safeExec("priority_derived_metrics view", `
    CREATE OR REPLACE VIEW priority_derived_metrics AS
    SELECT
      cp.id AS priority_id,
      COUNT(DISTINCT pp.project_id) AS project_count,
      COUNT(DISTINCT CASE
        WHEN LOWER(pes.rag_status) IN ('red') THEN pp.project_id
      END) AS at_risk_project_count,
      CASE
        WHEN bool_or(LOWER(pes.rag_status) = 'red') THEN 'critical'
        WHEN bool_or(LOWER(pes.rag_status) IN ('amber', 'orange')) THEN 'at_risk'
        WHEN COUNT(DISTINCT pp.project_id) = 0 THEN NULL
        ELSE 'healthy'
      END AS derived_health,
      COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0) AS total_revenue,
      COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_cos,
      COALESCE(SUM(CAST(dpk.total_planned_revenue AS NUMERIC)), 0)
        - COALESCE(SUM(CAST(dpk.total_planned_expenses AS NUMERIC)), 0) AS total_gp,
      COALESCE(AVG(CAST(dpk.avg_actual_pct_complete AS NUMERIC)), 0) AS avg_progress,
      (SELECT COUNT(*) FROM work_items wi
       WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
       AND (LOWER(wi.status) LIKE '%block%')
       AND wi.deleted_at IS NULL) AS blocker_count,
      (SELECT COUNT(*) FROM work_items wi
       WHERE wi.project_id IN (SELECT project_id FROM priority_projects WHERE priority_id = cp.id)
       AND LOWER(wi.status) NOT IN ('complete', 'completed', 'done', 'cancelled', 'canceled', 'qc approved')
       AND wi.deleted_at IS NULL) AS open_task_count
    FROM mytool_company_priorities cp
    LEFT JOIN priority_projects pp ON cp.id = pp.priority_id
    LEFT JOIN project_execution_state pes ON pp.project_id = pes.project_id
    LEFT JOIN derived_project_kpis dpk ON pp.project_id = dpk.project_id
    GROUP BY cp.id;
  `);

  // ── Migrate priority_links to priority_projects (one-time backfill) ──
  await safeExec("migrate priority_links to priority_projects", `
    INSERT INTO priority_projects (priority_id, project_id, linked_at)
    SELECT pl.priority_id, pl.project_id, pl.created_at
    FROM priority_links pl
    WHERE pl.project_id IS NOT NULL
    ON CONFLICT (priority_id, project_id) DO NOTHING;
  `);

  // ── Backfill owner_user_id from assigned_to text ──
  await safeExec("backfill priority owner_user_id", `
    UPDATE mytool_company_priorities mcp
    SET owner_user_id = u.id
    FROM users u
    WHERE mcp.assigned_to IS NOT NULL
      AND mcp.owner_user_id IS NULL
      AND LOWER(TRIM(mcp.assigned_to)) = LOWER(TRIM(u.name));
  `);

  // ── Cascading priorities: scope enum + new columns ──
  await safeExec("priority scope enum", `
    DO $$ BEGIN
      CREATE TYPE mytool_priority_scope AS ENUM ('company', 'department', 'role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await safeExec("priority cascading columns", `
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS scope mytool_priority_scope NOT NULL DEFAULT 'company';
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES mytool_company_priorities(id) ON DELETE SET NULL;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS department_key TEXT;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id);
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
    ALTER TABLE mytool_company_priorities ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
    CREATE INDEX IF NOT EXISTS idx_priorities_scope ON mytool_company_priorities(scope);
    CREATE INDEX IF NOT EXISTS idx_priorities_parent_id ON mytool_company_priorities(parent_id);
    CREATE INDEX IF NOT EXISTS idx_priorities_department_key ON mytool_company_priorities(department_key);
    CREATE INDEX IF NOT EXISTS idx_priorities_assigned_user_id ON mytool_company_priorities(assigned_user_id);
  `);

  // Stage Lifecycle: Core gate-driven workflow tables
  await safeExec("stage_definitions table", `
    CREATE TABLE IF NOT EXISTS stage_definitions (
      id SERIAL PRIMARY KEY,
      stage_code TEXT NOT NULL UNIQUE,
      stage_name TEXT NOT NULL,
      stage_sequence INTEGER NOT NULL,
      description TEXT,
      default_owner_role TEXT,
      default_approver_role TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("stage_checklist_templates table", `
    CREATE TABLE IF NOT EXISTS stage_checklist_templates (
      id SERIAL PRIMARY KEY,
      stage_code TEXT NOT NULL,
      department TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_code TEXT NOT NULL,
      blocks_gate BOOLEAN NOT NULL DEFAULT false,
      is_required BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("project_stage_instances table", `
    CREATE TABLE IF NOT EXISTS project_stage_instances (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      stage_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      stage_owner_user_id INTEGER REFERENCES users(id),
      approver_user_id INTEGER REFERENCES users(id),
      readiness_pct INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      target_exit_date DATE,
      waiting_on_department TEXT,
      waiting_on_user_id INTEGER REFERENCES users(id),
      next_required_action TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT project_stage_instances_project_stage_uq UNIQUE (project_id, stage_code)
    );
    CREATE INDEX IF NOT EXISTS psi_project_id_idx ON project_stage_instances(project_id);
    CREATE INDEX IF NOT EXISTS psi_stage_status_idx ON project_stage_instances(stage_status);
  `);

  await safeExec("project_stage_requirements table", `
    CREATE TABLE IF NOT EXISTS project_stage_requirements (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_instance_id INTEGER NOT NULL REFERENCES project_stage_instances(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      department TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_code TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id),
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      blocks_gate BOOLEAN NOT NULL DEFAULT false,
      evidence_url TEXT,
      evidence_attached BOOLEAN NOT NULL DEFAULT false,
      completed_by_user_id INTEGER REFERENCES users(id),
      completed_date TIMESTAMP,
      contributors JSONB DEFAULT '[]',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS psr_stage_instance_idx ON project_stage_requirements(stage_instance_id);
    CREATE INDEX IF NOT EXISTS psr_department_idx ON project_stage_requirements(department);
    CREATE INDEX IF NOT EXISTS psr_status_idx ON project_stage_requirements(status);
  `);

  await safeExec("project_stage_evidence table", `
    CREATE TABLE IF NOT EXISTS project_stage_evidence (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_instance_id INTEGER NOT NULL REFERENCES project_stage_instances(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      evidence_type TEXT,
      title TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_by_user_id INTEGER REFERENCES users(id),
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      inherited_from_stage TEXT,
      review_status TEXT DEFAULT 'pending',
      reviewed_by_user_id INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      notes TEXT
    );
  `);

  await safeExec("project_stage_exceptions table", `
    CREATE TABLE IF NOT EXISTS project_stage_exceptions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      requirement_code TEXT,
      reason_text TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
      mitigation_text TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      approver_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      conditions_text TEXT,
      closeout_due_date DATE,
      downstream_blocking_stage TEXT,
      approved_at TIMESTAMP,
      closed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pse_project_id_idx ON project_stage_exceptions(project_id);
    CREATE INDEX IF NOT EXISTS pse_status_idx ON project_stage_exceptions(status);
  `);

  await safeExec("project_stage_decisions table", `
    CREATE TABLE IF NOT EXISTS project_stage_decisions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      decision_summary TEXT NOT NULL,
      decided_by_user_id INTEGER REFERENCES users(id),
      decided_date TIMESTAMP NOT NULL DEFAULT NOW(),
      rationale TEXT,
      impacted_departments JSONB DEFAULT '[]',
      impacted_downstream_stages JSONB DEFAULT '[]',
      evidence_url TEXT,
      related_exception_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await safeExec("project_stage_dependencies table", `
    CREATE TABLE IF NOT EXISTS project_stage_dependencies (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      from_department TEXT NOT NULL,
      from_user_id INTEGER REFERENCES users(id),
      to_department TEXT NOT NULL,
      to_user_id INTEGER REFERENCES users(id),
      description TEXT NOT NULL,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'WAITING',
      escalated BOOLEAN NOT NULL DEFAULT false,
      escalation_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS psd_project_id_idx ON project_stage_dependencies(project_id);
    CREATE INDEX IF NOT EXISTS psd_status_idx ON project_stage_dependencies(status);
  `);

  await safeExec("project_access table", `
    CREATE TABLE IF NOT EXISTS project_access (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_level TEXT NOT NULL DEFAULT 'viewer',
      role_on_project TEXT,
      stages_visible TEXT[] NOT NULL DEFAULT '{}',
      can_edit BOOLEAN NOT NULL DEFAULT false,
      can_approve BOOLEAN NOT NULL DEFAULT false,
      granted_by_user_id INTEGER REFERENCES users(id),
      granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP,
      notes TEXT,
      CONSTRAINT project_access_project_user_uq UNIQUE (project_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS pa_project_id_idx ON project_access(project_id);
    CREATE INDEX IF NOT EXISTS pa_user_id_idx ON project_access(user_id);
  `);

  // Stage Data: flexible JSONB stage fields + project charters
  await safeExec("project_stage_data table", `
    CREATE TABLE IF NOT EXISTS project_stage_data (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      updated_by_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT project_stage_data_project_stage_uq UNIQUE (project_id, stage_code)
    );
    CREATE INDEX IF NOT EXISTS psd_data_project_id_idx ON project_stage_data(project_id);
  `);

  await safeExec("project_charters table", `
    CREATE TABLE IF NOT EXISTS project_charters (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE REFERENCES project_info(id) ON DELETE CASCADE,
      charter_project_name TEXT,
      charter_site_name TEXT,
      charter_site_address TEXT,
      charter_gps_coordinates TEXT,
      charter_facility_type TEXT,
      charter_utility_supplier TEXT,
      charter_existing_infrastructure TEXT,
      charter_roof_type TEXT,
      charter_access_method TEXT,
      charter_special_site_notes TEXT,
      charter_structural_assessment_done BOOLEAN DEFAULT false,
      charter_structural_assessment_notes TEXT,
      charter_client_name TEXT,
      charter_client_type TEXT,
      charter_primary_contact_name TEXT,
      charter_primary_contact_email TEXT,
      charter_primary_contact_phone TEXT,
      charter_client_relationship_notes TEXT,
      charter_pd_user_id INTEGER REFERENCES users(id),
      charter_programme_manager_user_id INTEGER REFERENCES users(id),
      charter_project_manager_user_id INTEGER REFERENCES users(id),
      charter_procurement_manager_user_id INTEGER REFERENCES users(id),
      charter_om_manager_user_id INTEGER REFERENCES users(id),
      charter_asset_manager_user_id INTEGER REFERENCES users(id),
      charter_compliance_officer_user_id INTEGER REFERENCES users(id),
      charter_safety_officer_user_id INTEGER REFERENCES users(id),
      charter_designer_user_id INTEGER REFERENCES users(id),
      charter_preferred_installer TEXT,
      charter_system_type TEXT,
      charter_system_size_kwp REAL,
      charter_inverter_capacity_kva REAL,
      charter_battery_capacity_kwh REAL,
      charter_module_spec TEXT,
      charter_inverter_spec TEXT,
      charter_mounting_type TEXT,
      charter_monitoring_system TEXT,
      charter_metering TEXT,
      charter_diesel_gen_integration BOOLEAN DEFAULT false,
      charter_dedicated_feeder BOOLEAN DEFAULT false,
      charter_transformer_details TEXT,
      charter_tie_in_points TEXT,
      charter_main_breaker_details TEXT,
      charter_internet_provision TEXT,
      charter_hse_contact_established BOOLEAN DEFAULT false,
      charter_lifelines_required BOOLEAN DEFAULT false,
      charter_additional_security_required BOOLEAN DEFAULT false,
      charter_hse_notes TEXT,
      charter_sseg_application_status TEXT,
      charter_grid_study_status TEXT,
      charter_notification_number TEXT,
      charter_om_contract_type TEXT,
      charter_waterpoints_available BOOLEAN DEFAULT false,
      charter_metering_billing_required BOOLEAN DEFAULT false,
      charter_om_special_notes TEXT,
      charter_alignment_meeting_date DATE,
      charter_installer_walkthrough_date DATE,
      charter_external_intro_meeting_date DATE,
      charter_internal_review_date DATE,
      charter_client_kickoff_date DATE,
      charter_site_establishment_date DATE,
      charter_expected_completion_date DATE,
      charter_handover_date_target DATE,
      charter_funding_model TEXT,
      charter_payment_terms_text TEXT,
      charter_invoice_conditions_text TEXT,
      charter_funding_partner TEXT,
      charter_deposit_status TEXT,
      charter_bdp_commission TEXT,
      charter_budget_notes TEXT,
      charter_overview_risk_summary TEXT,
      charter_stakeholder_risk_summary TEXT,
      charter_scope_risk_summary TEXT,
      charter_schedule_risk_summary TEXT,
      charter_budget_risk_summary TEXT,
      charter_triage_level TEXT,
      charter_opportunities_text TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by_user_id INTEGER REFERENCES users(id),
      updated_by_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Stage Collaboration: client commitments, client updates, queries, financial close tracks
  await safeExec("project_client_commitments table", `
    CREATE TABLE IF NOT EXISTS project_client_commitments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code_created TEXT,
      commitment_text TEXT NOT NULL,
      committed_by_user_id INTEGER REFERENCES users(id),
      committed_date TIMESTAMP NOT NULL DEFAULT NOW(),
      delivery_stage_code TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      delivered_date TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pcc_project_id_idx ON project_client_commitments(project_id);
    CREATE INDEX IF NOT EXISTS pcc_status_idx ON project_client_commitments(status);
  `);

  await safeExec("project_client_updates table", `
    CREATE TABLE IF NOT EXISTS project_client_updates (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      update_number INTEGER NOT NULL,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      progress_summary_text TEXT,
      completed_this_period_text TEXT,
      next_7_days_text TEXT,
      blockers_text TEXT,
      client_actions_required_text TEXT,
      attachment_urls JSONB DEFAULT '[]',
      sent_by_user_id INTEGER REFERENCES users(id),
      reviewer_user_id INTEGER REFERENCES users(id),
      sent_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT pcu_project_update_uq UNIQUE (project_id, update_number)
    );
    CREATE INDEX IF NOT EXISTS pcu_project_id_idx ON project_client_updates(project_id);
    CREATE INDEX IF NOT EXISTS pcu_status_idx ON project_client_updates(status);
  `);

  await safeExec("project_queries table", `
    CREATE TABLE IF NOT EXISTS project_queries (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT,
      query_type TEXT NOT NULL,
      raised_by_user_id INTEGER REFERENCES users(id),
      raised_by_department TEXT,
      assigned_to_user_id INTEGER REFERENCES users(id),
      assigned_to_department TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      status TEXT NOT NULL DEFAULT 'OPEN',
      response_text TEXT,
      responded_by_user_id INTEGER REFERENCES users(id),
      responded_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pq_project_id_idx ON project_queries(project_id);
    CREATE INDEX IF NOT EXISTS pq_status_idx ON project_queries(status);
    CREATE INDEX IF NOT EXISTS pq_assigned_to_idx ON project_queries(assigned_to_user_id);
  `);

  await safeExec("project_stage_financial_close_tracks table", `
    CREATE TABLE IF NOT EXISTS project_stage_financial_close_tracks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_instance_id INTEGER REFERENCES project_stage_instances(id) ON DELETE CASCADE,
      track_code TEXT NOT NULL,
      track_label TEXT NOT NULL,
      is_required BOOLEAN NOT NULL DEFAULT true,
      signed BOOLEAN NOT NULL DEFAULT false,
      signed_date DATE,
      document_url TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT psfct_project_track_uq UNIQUE (project_id, track_code)
    );
    CREATE INDEX IF NOT EXISTS psfct_project_id_idx ON project_stage_financial_close_tracks(project_id);
    CREATE INDEX IF NOT EXISTS psfct_stage_instance_idx ON project_stage_financial_close_tracks(stage_instance_id);
  `);

  // Collaboration Workflow: acceptances, reservations, commitments, evidence requests, client updates
  await safeExec("stage_acceptances table", `
    CREATE TABLE IF NOT EXISTS stage_acceptances (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      outcome TEXT NOT NULL,
      decided_by_user_id INTEGER REFERENCES users(id),
      decided_date TIMESTAMP NOT NULL DEFAULT NOW(),
      rejection_reason TEXT,
      admin_override BOOLEAN NOT NULL DEFAULT false,
      admin_override_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sa_project_id_idx ON stage_acceptances(project_id);
    CREATE INDEX IF NOT EXISTS sa_stage_code_idx ON stage_acceptances(stage_code);
  `);

  await safeExec("acceptance_reservations table", `
    CREATE TABLE IF NOT EXISTS acceptance_reservations (
      id SERIAL PRIMARY KEY,
      acceptance_id INTEGER NOT NULL REFERENCES stage_acceptances(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      description TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id),
      deadline DATE,
      status TEXT NOT NULL DEFAULT 'open',
      closed_date TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ar_project_id_idx ON acceptance_reservations(project_id);
    CREATE INDEX IF NOT EXISTS ar_acceptance_id_idx ON acceptance_reservations(acceptance_id);
    CREATE INDEX IF NOT EXISTS ar_status_idx ON acceptance_reservations(status);
  `);

  await safeExec("client_commitments table", `
    CREATE TABLE IF NOT EXISTS client_commitments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code_created TEXT NOT NULL,
      commitment_text TEXT NOT NULL,
      committed_by_user_id INTEGER REFERENCES users(id),
      committed_date TIMESTAMP NOT NULL DEFAULT NOW(),
      delivery_stage_code TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      delivered_date TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cc_project_id_idx ON client_commitments(project_id);
    CREATE INDEX IF NOT EXISTS cc_status_idx ON client_commitments(status);
  `);

  await safeExec("evidence_requests table", `
    CREATE TABLE IF NOT EXISTS evidence_requests (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      stage_code TEXT NOT NULL,
      requested_by_user_id INTEGER REFERENCES users(id),
      requested_from_department TEXT NOT NULL,
      requested_from_user_id INTEGER REFERENCES users(id),
      description TEXT NOT NULL,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'requested',
      evidence_url TEXT,
      fulfilled_date TIMESTAMP,
      linked_dependency_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS er_project_id_idx ON evidence_requests(project_id);
    CREATE INDEX IF NOT EXISTS er_status_idx ON evidence_requests(status);
    CREATE INDEX IF NOT EXISTS er_stage_code_idx ON evidence_requests(stage_code);
  `);

  await safeExec("client_updates table", `
    CREATE TABLE IF NOT EXISTS client_updates (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      update_number INTEGER NOT NULL DEFAULT 1,
      last_client_update_date TIMESTAMP,
      next_client_update_due_date TIMESTAMP,
      client_update_status TEXT NOT NULL DEFAULT 'draft',
      progress_summary_text TEXT,
      completed_this_period_text TEXT,
      next_7_days_text TEXT,
      blockers_text TEXT,
      client_actions_required_text TEXT,
      attachment_urls JSONB DEFAULT '[]',
      client_update_sent_by INTEGER REFERENCES users(id),
      reviewer_user_id INTEGER REFERENCES users(id),
      sent_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cu_project_id_idx ON client_updates(project_id);
    CREATE INDEX IF NOT EXISTS cu_status_idx ON client_updates(client_update_status);
  `);

  // Handover: lessons learnt, handover stakeholders
  await safeExec("lessons_learnt table", `
    CREATE TABLE IF NOT EXISTS lessons_learnt (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      tags JSONB DEFAULT '[]',
      project_type TEXT,
      technology_tags JSONB DEFAULT '[]',
      added_by_user_id INTEGER REFERENCES users(id),
      added_by_name TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
  `);

  await safeExec("handover_stakeholders table", `
    CREATE TABLE IF NOT EXISTS handover_stakeholders (
      id SERIAL PRIMARY KEY,
      handover_id INTEGER NOT NULL REFERENCES project_pd_pm_handover(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      counterparty_id INTEGER REFERENCES counterparties(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Finance: financial reviews
  await safeExec("project_financial_reviews table", `
    CREATE TABLE IF NOT EXISTS project_financial_reviews (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      version INTEGER NOT NULL DEFAULT 1,
      budget_baseline_id INTEGER,
      snapshot_budget_total DECIMAL(15,2),
      snapshot_actual_total DECIMAL(15,2),
      snapshot_variance DECIMAL(15,2),
      snapshot_variance_pct DECIMAL(8,4),
      snapshot_margin DECIMAL(8,4),
      snapshot_contingency_remaining DECIMAL(15,2),
      snapshot_procurement_readiness REAL,
      snapshot_data JSONB NOT NULL DEFAULT '{}',
      snapshot_captured_at TIMESTAMP,
      review_date DATE,
      review_meeting_ref TEXT,
      participants JSONB NOT NULL DEFAULT '[]',
      budget_review JSONB NOT NULL DEFAULT '{}',
      procurement_review JSONB NOT NULL DEFAULT '{}',
      scope_review JSONB NOT NULL DEFAULT '{}',
      logistics_review JSONB NOT NULL DEFAULT '{}',
      hse_review JSONB NOT NULL DEFAULT '{}',
      outcome TEXT,
      outcome_conditions TEXT,
      outcome_notes TEXT,
      requested_by_user_id INTEGER REFERENCES users(id),
      reviewed_by_user_id INTEGER REFERENCES users(id),
      approved_by_user_id INTEGER REFERENCES users(id),
      approved_at TIMESTAMP,
      approval_id INTEGER,
      gate_evaluation_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_financial_reviews_project_status ON project_financial_reviews(project_id, status);
  `);

  // EPC Workflow: Payment Requests, Batches, Proof of Payment
  await safeExec("payment enums", `
    DO $$ BEGIN
      CREATE TYPE payment_request_status AS ENUM ('new', 'in_review', 'loaded_for_payment', 'proof_attached', 'complete', 'requires_info', 'blocked');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    DO $$ BEGIN
      CREATE TYPE payment_batch_status AS ENUM ('preparing', 'submitted', 'approved', 'released', 'confirmed');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    DO $$ BEGIN
      CREATE TYPE po_status AS ENUM ('draft', 'submitted', 'in_review', 'requires_info', 'blocked', 'approved', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await safeExec("payment_requests table", `
    CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id),
      purchase_order_id INTEGER REFERENCES purchase_orders(id),
      invoice_capture_id INTEGER,
      counterparty_id INTEGER REFERENCES counterparties(id),
      procurement_item_id INTEGER,
      amount DECIMAL(15,2) NOT NULL,
      due_date DATE,
      status payment_request_status NOT NULL DEFAULT 'new',
      submitted_by_user_id INTEGER NOT NULL REFERENCES users(id),
      cutoff_date DATE,
      evidence_evaluation_id INTEGER,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_payment_req_project ON payment_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_payment_req_status ON payment_requests(status);
    CREATE INDEX IF NOT EXISTS idx_payment_req_cutoff ON payment_requests(cutoff_date);
  `);

  await safeExec("payment_batches table", `
    CREATE TABLE IF NOT EXISTS payment_batches (
      id SERIAL PRIMARY KEY,
      batch_number TEXT NOT NULL UNIQUE,
      cutoff_date DATE NOT NULL,
      total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      status payment_batch_status NOT NULL DEFAULT 'preparing',
      prepared_by_user_id INTEGER NOT NULL REFERENCES users(id),
      approved_by_user_id INTEGER REFERENCES users(id),
      released_by_user_id INTEGER REFERENCES users(id),
      approval_id INTEGER,
      approved_at TIMESTAMP,
      released_at TIMESTAMP,
      confirmed_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_payment_batch_status ON payment_batches(status);
    CREATE INDEX IF NOT EXISTS idx_payment_batch_cutoff ON payment_batches(cutoff_date);
  `);

  await safeExec("payment_batch_items table", `
    CREATE TABLE IF NOT EXISTS payment_batch_items (
      id SERIAL PRIMARY KEY,
      payment_batch_id INTEGER NOT NULL REFERENCES payment_batches(id) ON DELETE CASCADE,
      payment_request_id INTEGER NOT NULL REFERENCES payment_requests(id),
      amount DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_batch_item_batch ON payment_batch_items(payment_batch_id);
    CREATE INDEX IF NOT EXISTS idx_batch_item_request ON payment_batch_items(payment_request_id);
  `);

  await safeExec("proof_of_payment table", `
    CREATE TABLE IF NOT EXISTS proof_of_payment (
      id SERIAL PRIMARY KEY,
      payment_request_id INTEGER REFERENCES payment_requests(id),
      payment_batch_id INTEGER REFERENCES payment_batches(id),
      bank_reference TEXT,
      document_drive_id TEXT,
      document_item_id TEXT,
      document_url TEXT,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
      confirmed_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pop_request ON proof_of_payment(payment_request_id);
    CREATE INDEX IF NOT EXISTS idx_pop_batch ON proof_of_payment(payment_batch_id);
  `);

  // EPC Workflow: Purchase Orders & Review Assignments
  await safeExec("po_review_decision enum", `
    DO $$ BEGIN
      CREATE TYPE po_review_decision AS ENUM ('pending', 'approved', 'requires_info', 'blocked');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await safeExec("purchase_orders table", `
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      po_ref TEXT NOT NULL UNIQUE,
      po_number INTEGER NOT NULL,
      project_name TEXT NOT NULL,
      project_id INTEGER REFERENCES project_info(id),
      supplier_name TEXT NOT NULL,
      supplier_vat TEXT,
      supplier_address TEXT,
      supplier_contact TEXT,
      line_items JSONB NOT NULL DEFAULT '[]',
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      total DECIMAL(15,2) NOT NULL DEFAULT 0,
      payment_terms TEXT,
      delivery_date TEXT,
      delivery_address TEXT,
      site_contact TEXT,
      comments TEXT,
      project_manager TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMP,
      pdf_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_name);
    CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
  `);

  await safeExec("po_review_assignments table", `
    CREATE TABLE IF NOT EXISTS po_review_assignments (
      id SERIAL PRIMARY KEY,
      purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
      reviewer_role TEXT NOT NULL,
      decision po_review_decision NOT NULL DEFAULT 'pending',
      decided_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_po_review_po_id ON po_review_assignments(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_po_review_reviewer ON po_review_assignments(reviewer_user_id);
  `);

  // C1: Construction module tables
  await safeExec("site_activities table", `
    CREATE TABLE IF NOT EXISTS site_activities (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL DEFAULT 0,
      site_id INTEGER,
      activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
      activity_type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      reported_by_user_id INTEGER,
      status TEXT DEFAULT 'open',
      weather TEXT,
      crew_count INTEGER,
      photos TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
  `);

  await safeExec("snags table", `
    CREATE TABLE IF NOT EXISTS snags (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL DEFAULT 0,
      site_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      severity TEXT DEFAULT 'minor',
      location TEXT,
      reported_by_user_id INTEGER,
      assigned_to_user_id INTEGER,
      due_date DATE,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      evidence_link TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
  `);

  await safeExec("site_inspections table", `
    CREATE TABLE IF NOT EXISTS site_inspections (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL DEFAULT 0,
      site_id INTEGER,
      inspection_type TEXT NOT NULL DEFAULT '',
      inspector_user_id INTEGER,
      inspection_date DATE,
      result TEXT,
      notes TEXT,
      evidence_link TEXT,
      linked_snag_ids TEXT,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    );
  `);

  // Ensure construction tables have all required columns (may be missing if tables were created by an earlier version)
  await safeExec("construction table columns", `
    ALTER TABLE site_activities ADD COLUMN IF NOT EXISTS project_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE site_activities ADD COLUMN IF NOT EXISTS site_id INTEGER;
    ALTER TABLE snags ADD COLUMN IF NOT EXISTS project_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE snags ADD COLUMN IF NOT EXISTS site_id INTEGER;
    ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS project_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS site_id INTEGER;
  `);

  await safeExec("contractor_assignments table", `
    CREATE TABLE IF NOT EXISTS contractor_assignments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL DEFAULT 0,
      counterparty_id INTEGER,
      scope TEXT,
      start_date DATE,
      end_date DATE,
      performance_rating INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
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
    } catch (err: unknown) {
      log(`Could not check project_info count (${(err instanceof Error ? err.message : String(err))}) — auto-enabling data seed`, "Startup:DataSeed");
      effectiveDataSeedEnabled = true;
    }
  }
  await runStartupSeeds({ startupDataSeedEnabled: effectiveDataSeedEnabled, allowStartupMutations: effectiveDataSeedEnabled || allowStartupMutations, log });
  report.seeds.push(effectiveDataSeedEnabled ? "completed" : "skipped");

  // Integrity guard always runs (idempotent safety net for 1:1 relationships)
  try {
    const { runIntegrityGuard } = await import("./backfills/integrity-guard");
    await runIntegrityGuard(log);
  } catch (err: unknown) {
    log(`Integrity guard error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:IntegrityGuard");
  }

  // Stage instance backfill — ensures all projects have stage instances,
  // marks historical projects' prior stages as PROGRESSED (not forced through gates)
  try {
    const { runStageInstanceBackfill } = await import("./backfills/stage-instance-backfill");
    await runStageInstanceBackfill(log);
  } catch (err: unknown) {
    log(`Stage instance backfill error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:StageInstanceBackfill");
  }

  // Gate evaluation backfill — one-time: evaluates stage gates for all existing
  // projects so that gate_status and project_gate_evaluations are populated
  try {
    const { runGateEvaluationBackfill } = await import("./backfills/gate-evaluation-backfill");
    await runGateEvaluationBackfill(log);
  } catch (err: unknown) {
    log(`Gate evaluation backfill error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:GateEvaluationBackfill");
  }

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
