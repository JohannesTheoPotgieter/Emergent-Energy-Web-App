import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { resolveDbConfig, setDbConfigStatus } from "./db-config";
import { sql } from "drizzle-orm";
import { getStartupModes } from "./startup-modes";

let config = resolveDbConfig();

let db: any;
let dbMode: 'sqlite' | 'postgres';
let dbConfig: typeof config;
let isInitialized = false;

function attachSqliteExecuteCompat(dbInstance: any) {
  if (!dbInstance || typeof dbInstance.execute === "function") {
    return dbInstance;
  }

  const attachRowsShape = (rows: unknown, extra?: Record<string, unknown>) => {
    const normalized = Array.isArray(rows) ? rows : [];

    Object.defineProperty(normalized, "rows", {
      value: normalized,
      configurable: true,
      enumerable: false,
      writable: false,
    });

    if (extra && typeof extra === "object") {
      Object.assign(normalized, extra);
    }

    return normalized;
  };

  dbInstance.execute = async (query: unknown) => {
    try {
      const rows = await dbInstance.all(query);
      return attachRowsShape(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const shouldFallbackToRun =
        /does not return data/i.test(message) ||
        /no result columns/i.test(message) ||
        /use run\(\) instead/i.test(message);

      if (!shouldFallbackToRun) {
        throw error;
      }
    }

    const runResult = await dbInstance.run(query);
    return attachRowsShape([], runResult && typeof runResult === "object" ? runResult : undefined);
  };

  return dbInstance;
}

/**
 * Deterministic database initialization - selects DB ONCE and never switches.
 * In production, Postgres is mandatory and startup fails hard when unavailable.
 */
async function initializeDatabase(): Promise<void> {
  if (isInitialized) return;
  config = resolveDbConfig();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && (!config.connectionString || config.mode !== "postgres")) {
    throw new Error("[DB] Production requires PostgreSQL. Set a valid DATABASE_URL.");
  }
  
  if (config.mode === 'postgres' && config.connectionString) {
    // Try Postgres with short timeout to avoid blocking startup
    console.log(`[DB] Testing PostgreSQL connection to ${config.dbHost}...`);
    
    try {
      const isConnectable = await testPostgresConnection(config.connectionString, 10000);
      
      if (isConnectable) {
        // Use Postgres
        const pool = new pg.Pool({ 
          connectionString: config.connectionString,
          connectionTimeoutMillis: 10000,
          query_timeout: 30000,
        });
        db = drizzle(pool, { schema });
        dbMode = 'postgres';
        dbConfig = config;
        
        console.log(`[DB] ✓ Using PostgreSQL (host: ${config.dbHost})`);
        setDbConfigStatus({
          connected: true,
          mode: 'postgres',
          message: `Connected to PostgreSQL (${config.dbHost})`,
          host: config.dbHost,
        });

        // Ensure entity_assignments table exists (idempotent DDL)
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS public.entity_assignments (
              id SERIAL PRIMARY KEY,
              entity_type TEXT NOT NULL,
              entity_id INTEGER NOT NULL,
              project_id INTEGER REFERENCES public.project_info(id),
              assignment_role TEXT NOT NULL DEFAULT 'ASSIGNEE',
              assignee_type TEXT NOT NULL,
              assignee_id INTEGER NOT NULL,
              display_label_snapshot TEXT NOT NULL,
              active BOOLEAN NOT NULL DEFAULT TRUE,
              assigned_by_user_id INTEGER REFERENCES public.users(id),
              cleared_by_user_id INTEGER REFERENCES public.users(id),
              assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
              cleared_at TIMESTAMP,
              metadata JSONB,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
          `);
          await pool.query(`CREATE INDEX IF NOT EXISTS entity_assignments_entity_idx ON public.entity_assignments(entity_type, entity_id, active)`);
          await pool.query(`CREATE INDEX IF NOT EXISTS entity_assignments_project_idx ON public.entity_assignments(project_id, active)`);
          await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS entity_assignments_active_unique
            ON public.entity_assignments(entity_type, entity_id, assignment_role, assignee_type, assignee_id)
            WHERE active = TRUE
          `);
          console.log('[DB] ✓ entity_assignments table verified');
        } catch (ddlErr: any) {
          console.warn('[DB] entity_assignments DDL warning (non-fatal):', ddlErr.message);
        }

        isInitialized = true;
        return;
      }
    } catch (err: any) {
      if (isProduction) {
        throw new Error(`[DB] PostgreSQL connection failed in production: ${err.message}`);
      }
      console.warn(`[DB] ⚠ Postgres connection error (${err.message}), falling back to SQLite`);
    }

    if (isProduction) {
      throw new Error('[DB] PostgreSQL is configured but unreachable; refusing SQLite fallback in production.');
    }
  }

  if (config.strictMode) {
    throw new Error('[DB] Strict runtime requires PostgreSQL. SQLite initialization blocked.');
  }

  // Use SQLite (local/dev mode only)
  initializeSqlite();
  const { startupSchemaRepairEnabled } = getStartupModes();
  console.log(
    startupSchemaRepairEnabled
      ? '[DB] Startup schema repair enabled - running additive SQLite compatibility bootstrap'
      : '[DB] Startup schema repair disabled - running additive SQLite compatibility bootstrap',
  );
  await ensureSqliteSchema();
  isInitialized = true;
}

function testPostgresConnection(connectionString: string, timeoutMs: number = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const pool = new pg.Pool({ 
      connectionString, 
      connectionTimeoutMillis: timeoutMs,
      max: 1,
    });
    
    const timeout = setTimeout(() => {
      pool.end().catch(() => {});
      resolve(false);
    }, timeoutMs);
    
    pool.query('SELECT 1', (err) => {
      clearTimeout(timeout);
      pool.end().catch(() => {});
      resolve(!err);
    });
  });
}

function initializeSqlite() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const sqliteFile = path.join(dataDir, 'app.sqlite');
  console.log(`[DB] Using SQLite file: ${sqliteFile}`);
  
  const sqlite = new BetterSqlite3(sqliteFile);
  db = drizzleSqlite(sqlite, { schema });
  attachSqliteExecuteCompat(db);
  dbMode = 'sqlite';
  dbConfig = { mode: 'sqlite', error: config.error || 'SQLite selected', strictMode: config.strictMode };
  
  setDbConfigStatus({
    connected: true,
    mode: 'sqlite',
    message: `Using SQLite (${sqliteFile})`,
    host: undefined,
    error: config.error,
  });
}

async function ensureSqliteSchema() {
  console.log('[DB] Ensuring SQLite schema exists...');
  
  try {
    // Create users table if not exists
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        microsoft_id TEXT,
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN username TEXT`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN microsoft_id TEXT`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`));
    } catch {}
     
    // Project Info table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL UNIQUE,
        size_kwp REAL,
        pd TEXT,
        pm TEXT,
        contract_value REAL,
        phase TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Program Expense table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS program_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        row_number INTEGER,
        expense_category TEXT,
        expense_line_item TEXT,
        expense_qty REAL,
        expense_rate_unit REAL,
        expense_actual_total REAL,
        expense_po_number TEXT,
        expense_invoice_number TEXT,
        expense_invoiced_date TEXT,
        revenue_amount REAL,
        expense_payment_date TEXT,
        cos_amount REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Program Inflows table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS program_inflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        row_number INTEGER,
        milestone_no TEXT,
        milestone_name TEXT,
        milestone_percent REAL,
        milestone_amount REAL,
        planned_payment_date TEXT,
        milestone_invoice_number TEXT,
        invoice_raised_date TEXT,
        payment_received_date TEXT,
        milestone_notes TEXT,
        documents_received TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Project Plan table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        row_number INTEGER,
        task_no TEXT,
        high_level_programme TEXT,
        actual_start TEXT,
        duration_days INTEGER,
        actual_end TEXT,
        actual_pct_complete REAL,
        expected_pct_complete REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Cashflow Points table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS cashflow_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        series_name TEXT NOT NULL,
        point_date TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Finance Revenue Monthly table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_revenue_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        category TEXT NOT NULL,
        month_end_date TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Finance COS Monthly table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_cos_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        category TEXT NOT NULL,
        month_end_date TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Upload Metadata table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS upload_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        file_path TEXT,
        uploaded_by INTEGER,
        records_processed INTEGER DEFAULT 0,
        validation_errors TEXT,
        status TEXT DEFAULT 'success',
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Refresh Logs table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS refresh_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        triggered_by INTEGER,
        status TEXT DEFAULT 'success',
        refreshed_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Legacy tables for backward compatibility
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        manager TEXT NOT NULL,
        site TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Planning',
        stage TEXT NOT NULL DEFAULT 'Development',
        start_date TEXT NOT NULL,
        completion_date TEXT NOT NULL,
        budget REAL NOT NULL,
        source_file TEXT NOT NULL,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        vendor TEXT NOT NULL,
        invoice_number TEXT,
        status TEXT NOT NULL DEFAULT 'Forecast',
        source_sheet TEXT NOT NULL DEFAULT 'Expenditure Breakdown',
        row_locator INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS revenues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Forecast',
        source_sheet TEXT NOT NULL DEFAULT 'Revenue Tracking',
        row_locator INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        task_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Not Started',
        assignee TEXT NOT NULL,
        source_sheet TEXT NOT NULL DEFAULT 'Project Plan',
        row_locator INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Cashflow Planning Overrides table (user edits)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS cashflow_planning_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        week_start_date TEXT NOT NULL,
        series_name TEXT NOT NULL,
        override_value REAL NOT NULL,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS counterparties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_canonical TEXT NOT NULL,
        name_aliases TEXT NOT NULL DEFAULT '[]',
        type_default TEXT NOT NULL DEFAULT 'OTHER',
        is_core INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        role_tags TEXT NOT NULL DEFAULT '[]',
        vat_number TEXT,
        registration_number TEXT,
        address TEXT,
        contact_person TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        bank_name TEXT,
        bank_account_number TEXT,
        bank_branch_code TEXT,
        payment_terms TEXT,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT
      )
    `);
    try {
      await db.run(sql.raw(`ALTER TABLE counterparties ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE counterparties ADD COLUMN role_tags TEXT NOT NULL DEFAULT '[]'`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE counterparties ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`));
    } catch {}

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS counterparty_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        counterparty_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        title TEXT,
        role_tags TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_by_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_counterparty_contacts_counterparty_id ON counterparty_contacts(counterparty_id)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS entity_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        project_id INTEGER,
        assignment_role TEXT NOT NULL DEFAULT 'ASSIGNEE',
        assignee_type TEXT NOT NULL,
        assignee_id INTEGER NOT NULL,
        display_label_snapshot TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        assigned_by_user_id INTEGER,
        cleared_by_user_id INTEGER,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        cleared_at TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_entity_assignments_lookup ON entity_assignments(entity_type, entity_id, assignment_role, active)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_entity_assignments_assignee ON entity_assignments(assignee_type, assignee_id, active)`);
    await db.run(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_assignments_single_active
      ON entity_assignments(entity_type, entity_id, assignment_role)
      WHERE active = 1
        AND entity_type IN ('personal_task', 'engineering_task', 'quality_item', 'deliverable', 'approval', 'project_eng_approval', 'procurement_item', 'raid_item', 'commissioning_item', 'change_request')
    `);
    
    console.log('[DB] ✓ SQLite schema verified');
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT,
        sections TEXT NOT NULL DEFAULT '[]',
        can_manage_users INTEGER NOT NULL DEFAULT 0,
        can_manage_roles INTEGER NOT NULL DEFAULT 0,
        can_edit_data INTEGER NOT NULL DEFAULT 1,
        entity_permissions TEXT,
        authority_model TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_editable_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL UNIQUE,
        cost_proposal_signed TEXT,
        funding_signed TEXT,
        epc_contract_signed TEXT,
        cost_proposal_type TEXT,
        cost_proposal_link TEXT,
        cost_proposal_na_reason TEXT,
        funding_type TEXT,
        funding_link TEXT,
        funding_na_reason TEXT,
        epc_contract_type TEXT,
        epc_contract_link TEXT,
        epc_contract_na_reason TEXT,
        current_vo_total TEXT,
        comments TEXT,
        latest_update TEXT,
        latest_update_at TEXT,
        latest_update_by TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS milestone_task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        milestone_row_number INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        date_override TEXT,
        date_override_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_milestone_task_links_project ON milestone_task_links(project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS expense_task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        expense_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        date_override TEXT,
        date_override_reason TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_expense_task_links_project ON expense_task_links(project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS smart_import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        project_name TEXT NOT NULL,
        uploaded_by INTEGER,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        source_file_name TEXT NOT NULL,
        source_file_hash TEXT,
        status TEXT NOT NULL DEFAULT 'PREVIEW',
        template_profile_id INTEGER,
        summary_json TEXT,
        committed_at TEXT,
        committed_by INTEGER,
        records_attempted INTEGER,
        records_succeeded INTEGER,
        records_failed INTEGER,
        import_type TEXT
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_smart_import_runs_project_status ON smart_import_runs(project_name, status)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS normalized_revenue_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        description TEXT,
        milestone_name TEXT,
        amount_ex_vat TEXT,
        vat TEXT,
        invoice_number TEXT,
        invoice_date TEXT,
        invoice_date_font_color TEXT,
        invoice_date_confirmed INTEGER,
        expected_payment_date TEXT,
        paid_date TEXT,
        paid_date_font_color TEXT,
        paid_date_confirmed INTEGER,
        in_bank_date TEXT,
        status TEXT NOT NULL DEFAULT 'PLANNED',
        source_sheet TEXT,
        source_row INTEGER,
        import_run_id INTEGER,
        turnaround_days INTEGER
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_project ON normalized_revenue_lines(project_id, project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS normalized_cost_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        cost_category TEXT,
        counterparty_id INTEGER,
        counterparty_name TEXT,
        counterparty_type TEXT,
        description TEXT,
        amount_ex_vat TEXT,
        invoice_number TEXT,
        invoice_date TEXT,
        invoice_date_font_color TEXT,
        invoice_date_confirmed INTEGER,
        approved_date TEXT,
        paid_date TEXT,
        paid_date_font_color TEXT,
        paid_date_confirmed INTEGER,
        po_number TEXT,
        cos_realised INTEGER,
        cashflow_confirmed INTEGER,
        status TEXT NOT NULL DEFAULT 'PLANNED',
        cost_line_status TEXT NOT NULL DEFAULT 'PLANNED',
        source_sheet TEXT,
        source_row INTEGER,
        import_run_id INTEGER,
        turnaround_days INTEGER,
        pattern_rule_id INTEGER,
        pattern_classified_at TEXT,
        pattern_inferred_type TEXT,
        no_revenue_linked INTEGER NOT NULL DEFAULT 0
      )
    `);
    try {
      await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN cost_line_status TEXT NOT NULL DEFAULT 'PLANNED'`));
    } catch {}
    await db.run(sql.raw(`
      UPDATE normalized_cost_lines
      SET cost_line_status = COALESCE(NULLIF(cost_line_status, ''), NULLIF(status, ''), 'PLANNED')
      WHERE cost_line_status IS NULL OR TRIM(cost_line_status) = ''
    `));
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project ON normalized_cost_lines(project_id, project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS invoice_pattern_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL,
        pattern_value TEXT NOT NULL,
        normalized_example TEXT,
        counterparty_id INTEGER,
        counterparty_name TEXT,
        inferred_type TEXT NOT NULL DEFAULT 'OTHER',
        confidence_weight INTEGER NOT NULL DEFAULT 50,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_confirmed_at TEXT,
        times_matched INTEGER NOT NULL DEFAULT 0,
        times_confirmed INTEGER NOT NULL DEFAULT 0,
        times_overridden INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS invoice_pattern_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_run_id INTEGER,
        project_id INTEGER,
        invoice_number_raw TEXT,
        invoice_number_norm TEXT,
        matched_rule_id INTEGER,
        inferred_type TEXT NOT NULL DEFAULT 'OTHER',
        inferred_counterparty_id INTEGER,
        confidence_score INTEGER NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL DEFAULT 'UNRESOLVED',
        source_row INTEGER,
        override_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        project_id INTEGER NOT NULL,
        workstream TEXT NOT NULL,
        type TEXT,
        source TEXT NOT NULL DEFAULT 'UI',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'Not Started',
        priority TEXT,
        start_date TEXT,
        end_date TEXT,
        duration INTEGER,
        percent_complete REAL DEFAULT 0,
        expected_pct_complete REAL,
        wbs_code TEXT,
        outline_number TEXT,
        indent_level INTEGER DEFAULT 0,
        parent_id INTEGER,
        is_milestone INTEGER DEFAULT 0,
        phase TEXT,
        owner_user_id INTEGER,
        owner_name TEXT,
        is_shared INTEGER NOT NULL DEFAULT 0,
        external_ref TEXT,
        legacy_table TEXT,
        legacy_id INTEGER,
        source_row INTEGER,
        source_sheet TEXT,
        import_run_id INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT,
        baseline_start TEXT,
        baseline_end TEXT,
        baseline_duration INTEGER,
        task_mode TEXT DEFAULT 'auto',
        actual_start TEXT,
        actual_end TEXT,
        actual_duration INTEGER,
        sort_order INTEGER DEFAULT 0
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project_id, deleted_at)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS work_item_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'ASSIGNEE',
        allocation_pct REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_item_assignments_item ON work_item_assignments(work_item_id)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by INTEGER NOT NULL,
        requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
        decided_by INTEGER,
        decided_at TEXT,
        decision_note TEXT,
        token TEXT,
        expires_at TEXT,
        related_entity_type TEXT,
        related_entity_id INTEGER,
        assigned_approver INTEGER,
        due_date TEXT,
        project_id INTEGER NOT NULL,
        approval_category TEXT
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_approvals_project_status ON approvals(project_id, status)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS deliverables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        deliverable_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        phase TEXT,
        owner_user_id INTEGER,
        reviewer_user_id INTEGER,
        qc_reviewer_user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'TO DO',
        current_version INTEGER NOT NULL DEFAULT 1,
        sharepoint_folder_site_id TEXT,
        sharepoint_folder_drive_id TEXT,
        sharepoint_folder_item_id TEXT,
        linked_plan_item_id INTEGER,
        linked_quality_item_instance_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_deliverables_project_status ON deliverables(project_id, status)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_name, created_at)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_phase_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        from_phase TEXT,
        to_phase TEXT NOT NULL,
        changed_by_user_id INTEGER NOT NULL,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        reason TEXT NOT NULL
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_phase_history_project ON project_phase_history(project_id, changed_at)`);

    // ── Task Management & Standup System ───────────────────────────────────
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS standup_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        team_label TEXT,
        project_id INTEGER,
        cadence TEXT NOT NULL DEFAULT 'EVERY_2_DAYS',
        cadence_days INTEGER NOT NULL DEFAULT 2,
        anchor_date TEXT NOT NULL,
        deadline_time TEXT DEFAULT '10:00',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS standup_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        is_required INTEGER NOT NULL DEFAULT 1,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_standup_participants_schedule ON standup_participants(schedule_id)`);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS standup_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        standup_date TEXT NOT NULL,
        what_i_did TEXT,
        what_im_doing TEXT,
        blockers TEXT,
        mood TEXT,
        is_late INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_standup_entries_schedule_date ON standup_entries(schedule_id, standup_date)`);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS task_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1',
        category TEXT NOT NULL DEFAULT 'CUSTOM',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS work_item_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(work_item_id, tag_id)
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_item_tags_item ON work_item_tags(work_item_id)`);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS task_time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_task_time_entries_item ON task_time_entries(work_item_id)`);

    // FYE Revenue Tracking tables
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_revenue_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL UNIQUE,
        planned_revenue REAL,
        planned_expenditure REAL,
        planned_profit REAL,
        planned_margin REAL,
        actual_revenue REAL,
        actual_expenditure REAL,
        actual_profit REAL,
        actual_margin REAL,
        vo_pm_limit REAL,
        current_vo_total REAL,
        project_id INTEGER,
        captured_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS fye_budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        project_name TEXT NOT NULL,
        fye TEXT NOT NULL,
        month_key TEXT NOT NULL,
        budget_type TEXT NOT NULL,
        amount TEXT NOT NULL DEFAULT '0',
        updated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS forecast_pipeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_developer TEXT,
        location TEXT,
        size_kwp TEXT,
        deal_probability_pct INTEGER NOT NULL DEFAULT 0,
        forecast_signature_date TEXT,
        solar_revenue TEXT DEFAULT '0',
        bess_revenue TEXT DEFAULT '0',
        forecast_gp_pct TEXT DEFAULT '0',
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        updated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS lost_deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_name TEXT NOT NULL,
        deal_value TEXT,
        business_developer TEXT,
        lost_reason TEXT,
        lost_date TEXT,
        notes TEXT,
        updated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS pd_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_site_name TEXT,
        province TEXT,
        ticket_number TEXT,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to project_info (safe ALTERs — all columns from Drizzle schema)
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN signed_status TEXT NOT NULL DEFAULT 'NONE'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN construction_start_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN commissioning_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN signed_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN archived_status TEXT NOT NULL DEFAULT 'ACTIVE'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN execution_phase TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN phase_updated_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN phase_updated_by_user_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN phase_notes TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN pd_handover_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN om_handover_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN client_handover_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN escalation_level TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN construction_start_actual TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN pd_handover_actual TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN commissioning_actual TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN client_handover_actual TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN rag_status TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN rag_comment TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN rag_updated_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN rag_updated_by_user_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN execution_enabled INTEGER NOT NULL DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN execution_gate_reason TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN signed_document_link TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN excel_tracker_link TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN canonical_project_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN client_id INTEGER`)); } catch {}

    // Add missing columns to program_expense (safe ALTERs)
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN row_type TEXT DEFAULT 'item'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN actual_cos_total REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN budget_qty REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN budget_rate_unit REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN budget_total REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN budget_cos_total REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN supplier_name TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN project_id INTEGER`)); } catch {}

    // Add missing columns to program_expense (more columns from Drizzle schema)
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN forecast_payment_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN invoice_date_confirmed INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN invoice_date_font_color TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN expense_payment_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN payment_date_confirmed INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN payment_date_font_color TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN line_status TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN expense_line_hash TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN computed_state TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN computed_forecast_payment_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN is_manual INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN data_source TEXT DEFAULT 'SMART_IMPORT'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_expense ADD COLUMN import_run_id INTEGER`)); } catch {}

    // Add missing columns to program_inflows (safe ALTERs)
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN in_bank INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN project_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN inflow_line_hash TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN computed_forecast_receipt_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN data_source TEXT DEFAULT 'SMART_IMPORT'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE program_inflows ADD COLUMN import_run_id INTEGER`)); } catch {}

    console.log('[DB] SQLite schema verified');
  } catch (err: any) {
    console.error('[DB] Error creating SQLite schema:', err.message);
  }
}

function getDbMode(): 'sqlite' | 'postgres' {
  return dbMode;
}

export { db, dbMode, dbConfig, initializeDatabase, getDbMode };
