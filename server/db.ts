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
let postgresPool: pg.Pool | null = null;

declare global {
  // Prevent duplicate pool creation under dev hot-reload in the same Node.js process.
  // eslint-disable-next-line no-var
  var __emergentPostgresPool: pg.Pool | undefined;
}

function getOrCreatePostgresPool(connectionString: string): pg.Pool {
  if (!globalThis.__emergentPostgresPool) {
    const pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
      idleTimeoutMillis: 30000,
      max: 10,
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    pool.on("error", (err) => {
      console.error("[DB] Pool background error (non-fatal):", err instanceof Error ? err.message : String(err));
    });

    globalThis.__emergentPostgresPool = pool;
  }

  return globalThis.__emergentPostgresPool;
}

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

function normalizeSqliteBinding(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (Buffer.isBuffer(value) || value === null) {
    return value;
  }
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function normalizeSqliteArgs(args: unknown[]): unknown[] {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !Buffer.isBuffer(args[0]) &&
    !(args[0] instanceof Date)
  ) {
    return [
      Object.fromEntries(
        Object.entries(args[0] as Record<string, unknown>).map(([key, value]) => [
          key,
          normalizeSqliteBinding(value),
        ]),
      ),
    ];
  }
  return args.map(normalizeSqliteBinding);
}

function installSqliteBindingCompat(sqlite: any) {
  const originalPrepare = sqlite.prepare.bind(sqlite);
  const statementMethods = new Set(["run", "get", "all", "iterate"]);
  const createStatementProxy = (statement: any): any =>
    new Proxy(statement, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && statementMethods.has(prop) && typeof value === "function") {
          return (...args: unknown[]) => value.apply(target, normalizeSqliteArgs(args));
        }
        if (typeof prop === "string" && prop === "raw" && typeof value === "function") {
          return (...args: unknown[]) => createStatementProxy(value.apply(target, args));
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  sqlite.prepare = (source: string) => {
    const statement = originalPrepare(source);
    return createStatementProxy(statement);
  };
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function getSqliteTableInfo(tableName: string): Promise<Array<{ name: string; notnull: number }>> {
  return (await db.all(sql.raw(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`))) as Array<{ name: string; notnull: number }>;
}

async function ensureSqliteColumn(tableName: string, columnName: string, columnDefinition: string): Promise<void> {
  const columns = await getSqliteTableInfo(tableName);
  if (columns.some((column) => column.name === columnName)) return;
  await db.run(sql.raw(
    `ALTER TABLE ${quoteSqliteIdentifier(tableName)} ADD COLUMN ${quoteSqliteIdentifier(columnName)} ${columnDefinition}`,
  ));
}

async function ensureSqliteWorkItemsProjectNullable() {
  const columns = await getSqliteTableInfo("work_items");
  const projectColumn = columns.find((column) => column.name === "project_id");
  if (!projectColumn || Number(projectColumn.notnull) !== 1) return;

  const backupTable = "work_items__project_nullable_old";
  await db.run(sql.raw(`DROP TABLE IF EXISTS ${quoteSqliteIdentifier(backupTable)}`));
  await db.run(sql.raw(`ALTER TABLE work_items RENAME TO ${quoteSqliteIdentifier(backupTable)}`));
  await db.run(sql.raw(`
    CREATE TABLE work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      project_id INTEGER,
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
      sort_order INTEGER DEFAULT 0,
      estimate_minutes INTEGER,
      task_category TEXT,
      is_recurring INTEGER DEFAULT 0,
      recurrence_frequency TEXT,
      recurrence_interval INTEGER DEFAULT 1,
      recurrence_days_of_week TEXT,
      recurrence_end_date TEXT,
      recurrence_parent_id INTEGER,
      sub_project_name TEXT,
      engineering_ticket_id INTEGER,
      bucket TEXT,
      pinned_today INTEGER DEFAULT 0,
      pinned_week INTEGER DEFAULT 0,
      source_email_id TEXT,
      source_email_subject TEXT,
      next_step TEXT,
      definition_of_done TEXT,
      completion_note TEXT,
      funding_type TEXT,
      size_kwp REAL,
      province TEXT,
      gps_coordinates TEXT,
      batteries_needed INTEGER DEFAULT 0,
      battery_size REAL,
      lead TEXT,
      resource_1 TEXT,
      resource_2 TEXT,
      tracker_comments TEXT,
      work_days INTEGER,
      cell_format TEXT,
      row_hash TEXT,
      import_snapshot TEXT,
      manual_overrides TEXT,
      hold_reason TEXT,
      blocked_type TEXT,
      approval_required INTEGER NOT NULL DEFAULT 0,
      linked_plan_item_id INTEGER,
      linked_deliverable_id INTEGER,
      linked_quality_item_instance_id INTEGER,
      completed_at TEXT,
      tracking_rag TEXT,
      task_type_tag TEXT,
      blocker_reason TEXT
    )
  `));

  const oldColumns = new Set((await getSqliteTableInfo(backupTable)).map((column) => column.name));
  const newColumns = (await getSqliteTableInfo("work_items"))
    .map((column) => column.name)
    .filter((name) => oldColumns.has(name));
  if (newColumns.length > 0) {
    const columnList = newColumns.map(quoteSqliteIdentifier).join(", ");
    await db.run(sql.raw(`INSERT INTO work_items (${columnList}) SELECT ${columnList} FROM ${quoteSqliteIdentifier(backupTable)}`));
  }
  await db.run(sql.raw(`DROP TABLE ${quoteSqliteIdentifier(backupTable)}`));
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
    // Try Postgres with short timeout to avoid blocking startup. Retry the
    // reachability probe with bounded backoff so a cold scale-to-zero database
    // (Neon) does not crash the boot before the HTTP port opens. Still fails loud
    // in production if every attempt is exhausted (see testPostgresConnectionWithRetry).
    // Clamp env knobs to sane ranges so a misconfiguration can never create an
    // extreme pre-listen delay that itself blows the autoscale promote probe window.
    const clamp = (value: number, min: number, max: number, fallback: number) =>
      Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, min), max) : fallback;
    const perAttemptTimeoutMs = clamp(Number(process.env.DB_CONNECT_TIMEOUT_MS), 1000, 30000, 10000);
    const retryAttempts = clamp(
      Number(process.env.DB_CONNECT_RETRY_ATTEMPTS),
      1,
      10,
      isProduction ? 5 : 1,
    );
    const retryBackoffMs = clamp(Number(process.env.DB_CONNECT_RETRY_BACKOFF_MS), 0, 10000, 1000);
    console.log(
      `[DB] Testing PostgreSQL connection to ${config.dbHost}... (up to ${retryAttempts} attempt(s), ${perAttemptTimeoutMs}ms timeout each)`,
    );

    try {
      const isConnectable = await testPostgresConnectionWithRetry(
        config.connectionString,
        perAttemptTimeoutMs,
        retryAttempts,
        retryBackoffMs,
      );
      
      if (isConnectable) {
        // Use Postgres
        const pool = getOrCreatePostgresPool(config.connectionString);
        postgresPool = pool;
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

        // Ensure engineering columns on work_items (always a base table now)
        try {
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS hold_reason TEXT`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocked_type TEXT`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_plan_item_id INTEGER`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_deliverable_id INTEGER`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS linked_quality_item_instance_id INTEGER`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS tracking_rag TEXT`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_type_tag TEXT`);
          await pool.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS blocker_reason TEXT`);
          console.log('[DB] ✓ work_items engineering columns verified');
        } catch (ddlErr: any) {
          console.warn('[DB] work_items eng columns DDL warning (non-fatal):', ddlErr.message);
        }

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
    } catch (err: unknown) {
      if (isProduction) {
        throw new Error(`[DB] PostgreSQL connection failed in production: ${(err instanceof Error ? err.message : String(err))}`);
      }
      console.warn(`[DB] ⚠ Postgres connection error (${(err instanceof Error ? err.message : String(err))}), falling back to SQLite`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cold databases (e.g. Neon scale-to-zero) can refuse or time out the very first
 * connection while the compute wakes. A single failed probe at boot used to crash
 * the process before the HTTP port opened, intermittently failing autoscale
 * promote/health checks (the publish would fail ~1 in 4 attempts and clear on retry).
 *
 * Retry the reachability probe with bounded exponential backoff so a transient cold
 * start is tolerated, while STILL FAILING LOUD: if every attempt fails the function
 * returns false and the caller throws, so a genuinely-unavailable database fails the
 * publish and leaves the known-good version serving. This does NOT weaken the
 * fail-loud-on-bad-DB governance — it only distinguishes "cold, retry succeeds" from
 * "truly down, all retries exhausted".
 *
 * Tunable via env (defaults below): DB_CONNECT_RETRY_ATTEMPTS,
 * DB_CONNECT_RETRY_BACKOFF_MS, DB_CONNECT_TIMEOUT_MS.
 */
async function testPostgresConnectionWithRetry(
  connectionString: string,
  perAttemptTimeoutMs: number,
  attempts: number,
  baseBackoffMs: number,
): Promise<boolean> {
  const maxBackoffMs = 4000;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ok = await testPostgresConnection(connectionString, perAttemptTimeoutMs);
    if (ok) {
      if (attempt > 1) {
        console.log(`[DB] ✓ PostgreSQL reachable on attempt ${attempt}/${attempts}`);
      }
      return true;
    }
    if (attempt < attempts) {
      const wait = Math.min(baseBackoffMs * 2 ** (attempt - 1), maxBackoffMs);
      console.warn(
        `[DB] ⚠ PostgreSQL not reachable (attempt ${attempt}/${attempts}); retrying in ${wait}ms (cold-start tolerance)`,
      );
      await sleep(wait);
    }
  }
  return false;
}

function testPostgresConnection(connectionString: string, timeoutMs: number = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new pg.Client({
      connectionString, 
      connectionTimeoutMillis: timeoutMs,
    });
    
    const timeout = setTimeout(() => {
      client.end().catch(() => {});
      resolve(false);
    }, timeoutMs);
    
    client.connect((connectErr) => {
      if (connectErr) {
        clearTimeout(timeout);
        client.end().catch(() => {});
        resolve(false);
        return;
      }

      client.query('SELECT 1', (err) => {
        clearTimeout(timeout);
        client.end().catch(() => {});
        resolve(!err);
      });
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
  installSqliteBindingCompat(sqlite);
  sqlite.function('now', () => new Date().toISOString());
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
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN department TEXT`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN deleted_at TEXT`));
    } catch {}
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN location TEXT`));
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
        canonical_project_id INTEGER,
        client_id INTEGER,
        pm_user_id INTEGER,
        pd_user_id INTEGER,
        deleted_at TEXT,
        site_id INTEGER,
        opportunity_id INTEGER,
        delivery_model TEXT,
        project_code TEXT,
        project_status TEXT NOT NULL DEFAULT 'active',
        in_dlp INTEGER NOT NULL DEFAULT 0,
        phase TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipedrive_deal_id TEXT,
        source TEXT NOT NULL DEFAULT 'internal',
        client_id INTEGER,
        site_id INTEGER,
        deal_owner_user_id INTEGER,
        stage TEXT,
        contract_type TEXT,
        funding_type TEXT,
        estimated_value TEXT,
        estimated_kwp TEXT,
        estimated_kwh TEXT,
        proposal_issued_date TEXT,
        expected_close_date TEXT,
        signed_date TEXT,
        handover_readiness TEXT DEFAULT 'not_ready',
        commercial_risks TEXT,
        notes TEXT,
        status TEXT DEFAULT 'active',
        province TEXT,
        deal_name TEXT,
        deal_owner_name TEXT,
        currency TEXT NOT NULL DEFAULT 'ZAR',
        pipedrive_updated_at TEXT,
        pipedrive_stage_changed_at TEXT,
        probability TEXT,
        weighted_value TEXT,
        lost_reason TEXT,
        lost_time TEXT,
        person_name TEXT,
        person_email TEXT,
        person_phone TEXT,
        activities_count INTEGER NOT NULL DEFAULT 0,
        last_activity_date TEXT,
        next_activity_date TEXT,
        next_activity_subject TEXT,
        labels TEXT,
        company TEXT,
        project_name TEXT,
        owner TEXT,
        opportunity_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    for (const [column, definition] of [
      ["pipedrive_deal_id", "TEXT"],
      ["source", "TEXT NOT NULL DEFAULT 'internal'"],
      ["site_id", "INTEGER"],
      ["deal_owner_user_id", "INTEGER"],
      ["contract_type", "TEXT"],
      ["funding_type", "TEXT"],
      ["estimated_kwp", "TEXT"],
      ["estimated_kwh", "TEXT"],
      ["proposal_issued_date", "TEXT"],
      ["signed_date", "TEXT"],
      ["handover_readiness", "TEXT DEFAULT 'not_ready'"],
      ["commercial_risks", "TEXT"],
      ["notes", "TEXT"],
      ["province", "TEXT"],
      ["deal_name", "TEXT"],
      ["deal_owner_name", "TEXT"],
      ["currency", "TEXT NOT NULL DEFAULT 'ZAR'"],
      ["pipedrive_updated_at", "TEXT"],
      ["pipedrive_stage_changed_at", "TEXT"],
      ["probability", "TEXT"],
      ["weighted_value", "TEXT"],
      ["lost_reason", "TEXT"],
      ["lost_time", "TEXT"],
      ["person_name", "TEXT"],
      ["person_email", "TEXT"],
      ["person_phone", "TEXT"],
      ["activities_count", "INTEGER NOT NULL DEFAULT 0"],
      ["last_activity_date", "TEXT"],
      ["next_activity_date", "TEXT"],
      ["next_activity_subject", "TEXT"],
      ["labels", "TEXT"],
    ] as const) {
      await ensureSqliteColumn("opportunities", column, definition);
    }

    // SharePoint document management tables used by project Quality/Engineering registers.
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS company_sharepoint_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        drive_id TEXT,
        root_item_id TEXT,
        root_path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    // PHASE 5 DECOMMISSION: folder_taxonomy + project_folders were dropped
    // (browse-and-bind project_discipline_folders is the sole surface now).

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_approval_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taxonomy_key TEXT NOT NULL,
        file_name_pattern TEXT,
        display_name TEXT NOT NULL,
        description TEXT,
        approver_roles TEXT NOT NULL DEFAULT '[]',
        requires_all_approvers INTEGER NOT NULL DEFAULT 0,
        extract_spec TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS managed_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_scope TEXT NOT NULL,
        project_id INTEGER,
        company_root_id INTEGER,
        drive_id TEXT NOT NULL,
        drive_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        current_revision_id INTEGER,
        owner_user_id INTEGER,
        state TEXT NOT NULL DEFAULT 'draft',
        created_by_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS managed_documents_drive_item_idx ON managed_documents(drive_id, drive_item_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS managed_documents_project_idx ON managed_documents(project_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS managed_documents_company_root_idx ON managed_documents(company_root_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS managed_documents_owner_idx ON managed_documents(owner_user_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        revision_number INTEGER NOT NULL,
        sharepoint_version_id TEXT,
        size_bytes INTEGER,
        content_hash TEXT,
        uploaded_by_user_id INTEGER,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        is_current INTEGER NOT NULL DEFAULT 0,
        is_controlled INTEGER NOT NULL DEFAULT 0
      )
    `));
    await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS document_revisions_doc_rev_idx ON document_revisions(document_id, revision_number)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_revisions_current_idx ON document_revisions(document_id, is_current)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_locks (
        document_id INTEGER PRIMARY KEY,
        locked_by_user_id INTEGER NOT NULL,
        locked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        client_agent TEXT
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        revision_id INTEGER,
        parent_comment_id INTEGER,
        author_user_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        edited_at TEXT,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_comments_doc_idx ON document_comments(document_id, created_at)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_comments_parent_idx ON document_comments(parent_comment_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_comment_mentions (
        comment_id INTEGER NOT NULL,
        mentioned_user_id INTEGER NOT NULL
      )
    `));
    await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS document_comment_mentions_pk ON document_comment_mentions(comment_id, mentioned_user_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_comment_mentions_user_idx ON document_comment_mentions(mentioned_user_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        actor_role TEXT,
        root_scope TEXT NOT NULL,
        project_id INTEGER,
        company_root_id INTEGER,
        document_id INTEGER,
        revision_id INTEGER,
        drive_id TEXT NOT NULL,
        item_id TEXT,
        item_path TEXT,
        item_name TEXT,
        action TEXT NOT NULL,
        size_bytes INTEGER,
        request_id TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_activity_project_idx ON document_activity(project_id, created_at)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_activity_document_idx ON document_activity(document_id, created_at)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_activity_user_idx ON document_activity(user_id, created_at)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS document_activity_action_idx ON document_activity(action, created_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_document_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        managed_document_id INTEGER,
        domain TEXT NOT NULL,
        document_type TEXT NOT NULL,
        discipline TEXT,
        revision TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        review_status TEXT NOT NULL DEFAULT 'draft',
        current_revision INTEGER NOT NULL DEFAULT 1,
        superseded INTEGER NOT NULL DEFAULT 0,
        owner_user_id INTEGER,
        due_date TEXT,
        prepared_by_user_id INTEGER,
        reviewed_by_user_id INTEGER,
        approved_by_user_id INTEGER,
        approved_at TEXT,
        requires_preng_signoff INTEGER NOT NULL DEFAULT 0,
        preng_signed_off_by_user_id INTEGER,
        preng_signed_off_at TEXT,
        close_out_evidence_required INTEGER NOT NULL DEFAULT 0,
        close_out_evidence_linked INTEGER NOT NULL DEFAULT 0,
        sharepoint_drive_id TEXT,
        sharepoint_item_id TEXT,
        sharepoint_web_url TEXT,
        sharepoint_folder_path TEXT,
        file_name TEXT,
        last_synced_at TEXT,
        sync_confidence TEXT NOT NULL DEFAULT 'high',
        notes TEXT,
        created_by_user_id INTEGER,
        updated_by_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS project_document_links_project_domain_idx ON project_document_links(project_id, domain)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS project_document_links_managed_document_idx ON project_document_links(managed_document_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS project_document_links_sharepoint_item_idx ON project_document_links(sharepoint_drive_id, sharepoint_item_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS project_document_links_status_idx ON project_document_links(status, review_status)`));
    
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
        project_id INTEGER,
        series_name TEXT NOT NULL,
        point_date TEXT NOT NULL,
        value REAL,
        source TEXT DEFAULT 'imported',
        import_snapshot TEXT,
        last_edited_by INTEGER,
        last_edited_at TEXT,
        effective_from TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["project_id", "INTEGER"],
      ["source", "TEXT DEFAULT 'imported'"],
      ["import_snapshot", "TEXT"],
      ["last_edited_by", "INTEGER"],
      ["last_edited_at", "TEXT"],
      ["effective_from", "TEXT DEFAULT CURRENT_TIMESTAMP"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("cashflow_points", column, definition);
    }
    
    // Finance Revenue Monthly table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_revenue_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        category TEXT NOT NULL,
        month_end_date TEXT NOT NULL,
        value REAL,
        source TEXT DEFAULT 'imported',
        import_snapshot TEXT,
        last_edited_by INTEGER,
        last_edited_at TEXT,
        effective_from TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["project_id", "INTEGER"],
      ["source", "TEXT DEFAULT 'imported'"],
      ["import_snapshot", "TEXT"],
      ["last_edited_by", "INTEGER"],
      ["last_edited_at", "TEXT"],
      ["effective_from", "TEXT DEFAULT CURRENT_TIMESTAMP"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("finance_revenue_monthly", column, definition);
    }
    
    // Finance COS Monthly table (matches Drizzle schema)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_cos_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        category TEXT NOT NULL,
        month_end_date TEXT NOT NULL,
        value REAL,
        source TEXT DEFAULT 'imported',
        import_snapshot TEXT,
        last_edited_by INTEGER,
        last_edited_at TEXT,
        effective_from TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["project_id", "INTEGER"],
      ["source", "TEXT DEFAULT 'imported'"],
      ["import_snapshot", "TEXT"],
      ["last_edited_by", "INTEGER"],
      ["last_edited_at", "TEXT"],
      ["effective_from", "TEXT DEFAULT CURRENT_TIMESTAMP"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("finance_cos_monthly", column, definition);
    }

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS tracker_monthly_manual (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracker_type TEXT NOT NULL,
        month_key TEXT NOT NULL,
        realised TEXT,
        outstanding TEXT,
        budget TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tracker_monthly_manual_type_month ON tracker_monthly_manual(tracker_type, month_key)`));
    
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
    
    // Legacy tables (projects, expenses, revenues, tasks, budgets) dropped.
    // Data lives in: project_info, normalized_cost_lines, normalized_revenue_lines, work_items.
    

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

    // Lifecycle execution state (SQLite fallback for Replit/dev)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_execution_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        phase TEXT,
        phase_updated_at TEXT,
        phase_updated_by_user_id INTEGER,
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
        rag_updated_at TEXT,
        rag_updated_by_user_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        archived_status TEXT NOT NULL DEFAULT 'ACTIVE',
        execution_enabled INTEGER NOT NULL DEFAULT 0,
        execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE',
        execution_gate_reason TEXT,
        execution_phase TEXT,
        signed_status TEXT NOT NULL DEFAULT 'NONE',
        signed_date TEXT,
        signed_document_link TEXT,
        cp_signed INTEGER NOT NULL DEFAULT 0,
        cp_signed_date TEXT,
        cp_signed_by_user_id INTEGER,
        cp_evidence_type TEXT,
        cp_evidence_ref TEXT,
        pm_task_pack_created INTEGER NOT NULL DEFAULT 0,
        eng_post_cp_task_pack_created INTEGER NOT NULL DEFAULT 0,
        construction_manager_user_id INTEGER,
        quality_lead_user_id INTEGER,
        engineering_lead_user_id INTEGER,
        program_manager_user_id INTEGER,
        project_finance_user_id INTEGER,
        matriarch_handover_target TEXT,
        practical_completion_target TEXT,
        practical_completion_actual TEXT,
        cost_baseline REAL,
        margin_baseline REAL,
        current_stage_code TEXT,
        gate_status TEXT,
        gate_readiness_pct INTEGER,
        waiting_on_department TEXT,
        waiting_on_user_id INTEGER,
        next_required_action TEXT,
        stage_owner_user_id INTEGER,
        stage_approver_user_id INTEGER,
        kam_user_id INTEGER,
        site_establishment_date TEXT,
        site_establishment_actual TEXT,
        financial_review_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
        financial_review_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_execution_state_phase ON project_execution_state(phase)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_execution_state_archived_status ON project_execution_state(archived_status)`);
    try { await db.run(sql.raw(`ALTER TABLE project_execution_state ADD COLUMN previous_phase TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_execution_state ADD COLUMN deleted_by INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_execution_state ADD COLUMN stage_started_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_execution_state ADD COLUMN stage_due_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_execution_state ADD COLUMN stage_completed_at TEXT`)); } catch {}

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        excel_tracker_link TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));

    // Calendar holidays (used by COS period lock scheduler)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS calendar_holiday (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        country_code TEXT NOT NULL DEFAULT 'ZA'
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_calendar_holiday_country_date ON calendar_holiday(country_code, date)`);

    // COS period lock ledger
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS cos_period_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_month TEXT NOT NULL,
        locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_by_user_id INTEGER,
        auto_locked INTEGER NOT NULL DEFAULT 0,
        unlocked_at TEXT,
        unlocked_by_user_id INTEGER,
        unlock_reason TEXT,
        notes TEXT
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cos_period_locks_period ON cos_period_locks(period_month)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cos_period_locks_active ON cos_period_locks(period_month, unlocked_at)`);

    // Integration health registry
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        owner_process TEXT,
        fallback_description TEXT,
        alert_target TEXT,
        metadata TEXT,
        last_alert_state TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `);
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS integration_run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id INTEGER NOT NULL,
        run_type TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        records_processed INTEGER,
        error_code TEXT,
        error_detail TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_integration_run_events_integration_id ON integration_run_events(integration_id)`);

    // Dashboard snapshot cache
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS dashboard_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_key TEXT NOT NULL,
        scope_key TEXT NOT NULL DEFAULT 'global',
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        error_detail TEXT,
        computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_success_at TEXT,
        compute_ms INTEGER,
        last_alert_state TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_snapshots_key_scope ON dashboard_snapshots(dashboard_key, scope_key)`);

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS dashboard_project_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        total_revenue TEXT NOT NULL DEFAULT '0',
        received_revenue TEXT NOT NULL DEFAULT '0',
        outstanding_revenue TEXT NOT NULL DEFAULT '0',
        total_cost TEXT NOT NULL DEFAULT '0',
        paid_cost TEXT NOT NULL DEFAULT '0',
        outstanding_cost TEXT NOT NULL DEFAULT '0',
        margin_pct TEXT,
        task_count INTEGER NOT NULL DEFAULT 0,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        tasks_in_progress INTEGER NOT NULL DEFAULT 0,
        tasks_overdue INTEGER NOT NULL DEFAULT 0,
        tasks_active INTEGER NOT NULL DEFAULT 0,
        open_warnings INTEGER NOT NULL DEFAULT 0,
        qc_progress_pct TEXT,
        health_score TEXT,
        phase TEXT,
        rag_status TEXT,
        contract_value TEXT,
        project_name TEXT,
        pm TEXT,
        pd TEXT,
        last_refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_dashboard_project_metrics_project ON dashboard_project_metrics(project_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS dashboard_program_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_projects INTEGER NOT NULL DEFAULT 0,
        active_projects INTEGER NOT NULL DEFAULT 0,
        total_program_revenue TEXT NOT NULL DEFAULT '0',
        total_program_cost TEXT NOT NULL DEFAULT '0',
        received_revenue TEXT NOT NULL DEFAULT '0',
        paid_cost TEXT NOT NULL DEFAULT '0',
        avg_margin TEXT,
        projects_at_risk INTEGER NOT NULL DEFAULT 0,
        total_tasks_overdue INTEGER NOT NULL DEFAULT 0,
        total_open_warnings INTEGER NOT NULL DEFAULT 0,
        last_refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        project_name TEXT,
        project_id INTEGER,
        linked_task_id INTEGER,
        linked_deliverable_id INTEGER,
        linked_warning_id INTEGER,
        linked_plan_item_id INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        read_at TEXT,
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        confirmed_by_user_id INTEGER,
        confirmed_at TEXT,
        change_details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS notifications_recipient_read_idx ON notifications(recipient_user_id, is_read)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS notification_throttle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(recipient_user_id, event_type, entity_type, entity_id)
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS app_screen_settings (
        screen_id TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by_user_id INTEGER
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS do_next_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        snoozed_until TEXT,
        dismissed_at TEXT,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        last_reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, item_key)
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS do_next_state_user_active_idx ON do_next_state(user_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS ms_integration_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL UNIQUE,
        config_value TEXT,
        updated_by INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS sp_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT,
        drive_id TEXT,
        folder_item_id TEXT,
        folder_path TEXT,
        interval_minutes INTEGER DEFAULT 30,
        enabled INTEGER DEFAULT 0,
        last_run_at TEXT,
        last_success_at TEXT,
        last_error_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        client_name TEXT,
        status TEXT NOT NULL DEFAULT 'Active',
        description TEXT,
        owner_user_id INTEGER,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS portfolio_rollout_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        notes TEXT,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS portfolio_rollout_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rollout_plan_id INTEGER NOT NULL,
        phase_name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        target_kwp TEXT,
        target_revenue TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_portfolio_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        portfolio_id INTEGER NOT NULL,
        assigned_by INTEGER,
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        moved_by INTEGER,
        moved_at TEXT
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS derived_project_kpis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL UNIQUE,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        phase TEXT,
        size_kwp TEXT,
        contract_value TEXT,
        rag_status TEXT,
        pm TEXT,
        pd TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        total_planned_revenue TEXT,
        total_actual_revenue TEXT,
        revenue_realised TEXT,
        revenue_outstanding TEXT,
        total_planned_expenses TEXT,
        total_actual_expenses TEXT,
        cos_realised TEXT,
        expenses_outstanding TEXT,
        gross_profit TEXT,
        gross_margin_pct TEXT,
        avg_actual_pct_complete TEXT,
        avg_expected_pct_complete TEXT,
        schedule_delta TEXT,
        task_count INTEGER NOT NULL DEFAULT 0,
        expense_line_count INTEGER NOT NULL DEFAULT 0,
        revenue_line_count INTEGER NOT NULL DEFAULT 0,
        needs_review INTEGER NOT NULL DEFAULT 0,
        needs_review_reason TEXT,
        computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    
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
        permission_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        scope TEXT,
        granted_by INTEGER REFERENCES users(id),
        reason TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, entity, action)
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        target_role TEXT,
        target_user_id INTEGER,
        changed_by_user_id INTEGER REFERENCES users(id),
        changed_by_role TEXT,
        change_detail TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS mytool_company_priorities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        department TEXT,
        horizon TEXT NOT NULL DEFAULT 'week',
        owner_role TEXT,
        linked_project_name TEXT,
        linked_project_id INTEGER,
        severity TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'active',
        priority_rank INTEGER,
        assigned_to TEXT,
        next_action TEXT,
        support TEXT,
        definition_of_done TEXT,
        due_date TEXT,
        linked_task_id INTEGER,
        linked_task_type TEXT,
        accountable_exec_id INTEGER,
        owner_user_id INTEGER,
        target_start_date TEXT,
        target_outcome TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        manual_health TEXT,
        manual_progress INTEGER,
        progress_source_type TEXT,
        progress_source_ref TEXT,
        scope TEXT NOT NULL DEFAULT 'company',
        parent_id INTEGER,
        department_key TEXT,
        assigned_user_id INTEGER,
        escalated INTEGER NOT NULL DEFAULT 0,
        escalated_at TEXT,
        escalation_reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_mytool_company_priorities_status ON mytool_company_priorities(status)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_mytool_company_priorities_owner ON mytool_company_priorities(owner_user_id, assigned_user_id)`));
    // Soft-delete column (migration 0069). Idempotent for existing dbs.
    try { await db.run(sql.raw(`ALTER TABLE mytool_company_priorities ADD COLUMN deleted_at TEXT`)); } catch {}
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_priorities_deleted_at ON mytool_company_priorities(deleted_at)`));
    // Review cadence columns (migration 0069_priorities_phase3).
    try { await db.run(sql.raw(`ALTER TABLE mytool_company_priorities ADD COLUMN review_cadence_days INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE mytool_company_priorities ADD COLUMN last_reviewed_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE mytool_company_priorities ADD COLUMN last_reviewed_by_user_id INTEGER`)); } catch {}

    // Priority templates (migration 0069_priorities_phase3).
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        title_template TEXT NOT NULL,
        body_template TEXT,
        scope_default TEXT NOT NULL DEFAULT 'role',
        severity_default TEXT NOT NULL DEFAULT 'normal',
        horizon_default TEXT NOT NULL DEFAULT 'week',
        department_key TEXT,
        target_outcome TEXT,
        definition_of_done TEXT,
        next_action TEXT,
        owner_role TEXT,
        created_by_user_id INTEGER,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_priority_templates_dept ON priority_templates(department_key)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_priority_templates_live ON priority_templates(deleted_at)`));

    // Priority saved views (migration 0069_priorities_phase3).
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_saved_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        active_tab TEXT NOT NULL DEFAULT 'my',
        scope TEXT,
        department_key TEXT,
        level_filter TEXT,
        health_filter TEXT,
        search_query TEXT,
        show_closed INTEGER NOT NULL DEFAULT 0,
        show_archived INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, name)
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_priority_saved_views_user ON priority_saved_views(user_id, sort_order)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        actor_name TEXT,
        action TEXT NOT NULL,
        from_value TEXT,
        to_value TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_priority_activity_priority ON priority_activity(priority_id, created_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        project_name TEXT,
        project_id INTEGER,
        task_id INTEGER,
        task_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        linked_by INTEGER,
        linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(priority_id, project_id)
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority_id INTEGER NOT NULL,
        author_user_id INTEGER,
        author_name TEXT,
        body TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_watches (
        user_id INTEGER NOT NULL,
        priority_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, priority_id)
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority_id INTEGER NOT NULL,
        opportunity_id INTEGER NOT NULL,
        linked_by INTEGER,
        linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(priority_id, opportunity_id)
      )
    `));

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_editable_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL UNIQUE,
        project_id INTEGER,
        funding_signed TEXT,
        cost_proposal_type TEXT,
        cost_proposal_link TEXT,
        cost_proposal_na_reason TEXT,
        funding_type TEXT,
        funding_link TEXT,
        funding_na_reason TEXT,
        epc_contract_type TEXT,
        epc_contract_link TEXT,
        epc_contract_na_reason TEXT,
        province TEXT,
        current_vo_total TEXT,
        comments TEXT,
        latest_update TEXT,
        latest_update_at TEXT,
        latest_update_by TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["project_id", "INTEGER"],
      ["province", "TEXT"],
    ] as const) {
      await ensureSqliteColumn("project_editable_fields", column, definition);
    }

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS milestone_task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        milestone_row_number INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        date_override TEXT,
        date_override_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await ensureSqliteColumn("milestone_task_links", "project_id", "INTEGER");
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_milestone_task_links_project ON milestone_task_links(project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS expense_task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        expense_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        date_override TEXT,
        date_override_reason TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        canonical_expense_id INTEGER,
        canonical_task_id INTEGER
      )
    `);
    for (const [column, definition] of [
      ["project_id", "INTEGER"],
      ["canonical_expense_id", "INTEGER"],
      ["canonical_task_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("expense_task_links", column, definition);
    }
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_expense_task_links_project ON expense_task_links(project_name)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_by INTEGER,
        updated_by INTEGER,
        legal_entity_name TEXT,
        trading_name TEXT,
        client_type TEXT,
        billing_entity TEXT,
        primary_contact_name TEXT,
        primary_contact_email TEXT,
        primary_contact_phone TEXT,
        secondary_contact_name TEXT,
        secondary_contact_email TEXT,
        industry TEXT,
        pipedrive_org_id TEXT,
        status TEXT DEFAULT 'active',
        primary_email_domain TEXT,
        additional_email_domains TEXT,
        deleted_at TEXT,
        merged_into_client_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["legal_entity_name", "TEXT"],
      ["trading_name", "TEXT"],
      ["client_type", "TEXT"],
      ["billing_entity", "TEXT"],
      ["primary_contact_name", "TEXT"],
      ["primary_contact_email", "TEXT"],
      ["primary_contact_phone", "TEXT"],
      ["secondary_contact_name", "TEXT"],
      ["secondary_contact_email", "TEXT"],
      ["industry", "TEXT"],
      ["pipedrive_org_id", "TEXT"],
      ["status", "TEXT DEFAULT 'active'"],
      ["primary_email_domain", "TEXT"],
      ["additional_email_domains", "TEXT"],
      ["deleted_at", "TEXT"],
      ["merged_into_client_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("clients", column, definition);
    }
    await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS clients_pipedrive_org_id_uniq_sqlite ON clients(pipedrive_org_id) WHERE pipedrive_org_id IS NOT NULL`));

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

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS normalized_execution_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        phase_name TEXT NOT NULL,
        phase_date TEXT,
        source TEXT NOT NULL DEFAULT 'EXCEL_IMPORT',
        import_run_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_normalized_execution_phases_project ON normalized_execution_phases(project_id)`));

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
    try { await db.run(sql.raw(`ALTER TABLE normalized_revenue_lines ADD COLUMN deleted_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_revenue_lines ADD COLUMN deleted_by INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_revenue_lines ADD COLUMN row_hash TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_revenue_lines ADD COLUMN import_snapshot TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_revenue_lines ADD COLUMN manual_overrides TEXT`)); } catch {}
    for (const [column, definition] of [
      ["milestone_no", "TEXT"],
      ["milestone_percent", "TEXT"],
      ["amount_ex_vat_legacy", "TEXT"],
      ["vat_legacy", "TEXT"],
      ["admin_date_override", "TEXT"],
      ["admin_date_override_reason", "TEXT"],
      ["admin_date_override_by", "INTEGER"],
      ["admin_date_override_at", "TEXT"],
      ["sub_project_name", "TEXT"],
      ["milestone_notes", "TEXT"],
      ["cell_format", "TEXT"],
      ["created_at", "TEXT"],
      ["updated_at", "TEXT"],
      ["effective_from", "TEXT"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("normalized_revenue_lines", column, definition);
    }
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
    try { await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN deleted_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN deleted_by INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN row_hash TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN import_snapshot TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN manual_overrides TEXT`)); } catch {}
    for (const [column, definition] of [
      ["amount_ex_vat_legacy", "TEXT"],
      ["budget_qty", "TEXT"],
      ["budget_rate", "TEXT"],
      ["budget_total", "TEXT"],
      ["budget_cos", "TEXT"],
      ["revenue_recognition_amount", "TEXT"],
      ["forecast_payment_date", "TEXT"],
      ["admin_date_override", "TEXT"],
      ["admin_date_override_reason", "TEXT"],
      ["admin_date_override_by", "INTEGER"],
      ["admin_date_override_at", "TEXT"],
      ["sub_project_name", "TEXT"],
      ["cos_status_override", "TEXT"],
      ["cos_status_override_by", "INTEGER"],
      ["cos_status_override_at", "TEXT"],
      ["cos_status_override_reason", "TEXT"],
      ["created_at", "TEXT"],
      ["updated_at", "TEXT"],
      ["effective_from", "TEXT"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
      ["idempotency_key", "TEXT"],
      ["category_key", "TEXT"],
      ["category_allocation_id", "INTEGER"],
      ["actual_qty", "TEXT"],
      ["actual_rate", "TEXT"],
      ["comments", "TEXT"],
      ["check_flag", "TEXT"],
      ["saving_overrun", "TEXT"],
      ["usd_exchange_rate", "TEXT"],
      ["price_per_watt", "TEXT"],
      ["cell_format", "TEXT"],
    ] as const) {
      await ensureSqliteColumn("normalized_cost_lines", column, definition);
    }
    await db.run(sql.raw(`
      UPDATE normalized_cost_lines
      SET cost_line_status = COALESCE(NULLIF(cost_line_status, ''), NULLIF(status, ''), 'PLANNED')
      WHERE cost_line_status IS NULL OR TRIM(cost_line_status) = ''
    `));
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project ON normalized_cost_lines(project_id, project_name)`);

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS category_revenue_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        category_number TEXT NOT NULL,
        category_name TEXT NOT NULL,
        category_key TEXT NOT NULL,
        category_sort_order INTEGER NOT NULL,
        revenue_allocation TEXT,
        allocation_confidence TEXT NOT NULL DEFAULT 'provisional',
        budget_total TEXT,
        budget_cos TEXT,
        import_run_id INTEGER,
        effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER,
        source_sheet TEXT,
        source_row INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_category_revenue_allocations_active
      ON category_revenue_allocations(project_id, category_key)
      WHERE effective_to IS NULL
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_history ON category_revenue_allocations(project_id, category_key, effective_to)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_import_run ON category_revenue_allocations(import_run_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS normalized_cost_line_actuals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cost_line_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        actual_no INTEGER NOT NULL,
        description TEXT,
        qty TEXT,
        rate TEXT,
        actual_total TEXT,
        po_number TEXT,
        invoice_number TEXT,
        invoice_date TEXT,
        revenue_recognition_amount TEXT,
        finance_payment_date TEXT,
        comments TEXT,
        check_flag TEXT,
        saving_overrun TEXT,
        cell_format TEXT,
        row_hash TEXT,
        import_snapshot TEXT,
        manual_overrides TEXT,
        source_sheet TEXT,
        source_row INTEGER,
        import_run_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        effective_from TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER
      )
    `));

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

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS invoice_description_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        counterparty_id INTEGER NOT NULL,
        counterparty_name TEXT,
        token_set TEXT NOT NULL,
        normalized_example TEXT,
        inferred_type TEXT NOT NULL DEFAULT 'OTHER',
        confidence_weight TEXT NOT NULL DEFAULT '50',
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        times_matched INTEGER NOT NULL DEFAULT 0,
        times_confirmed INTEGER NOT NULL DEFAULT 0,
        times_overridden INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        qb_entity_type TEXT NOT NULL DEFAULT 'bill',
        qb_entity_id TEXT NOT NULL,
        qb_realm_id TEXT NOT NULL,
        qb_doc_number TEXT,
        qb_txn_date TEXT,
        qb_counterparty_name TEXT,
        qb_counterparty_id TEXT,
        qb_amount_inc_vat TEXT,
        qb_tax_amount TEXT,
        qb_amount_ex_vat TEXT,
        amount_tolerance TEXT NOT NULL DEFAULT '0.01',
        tax_status TEXT NOT NULL DEFAULT 'KNOWN',
        assignment_status TEXT NOT NULL DEFAULT 'UNASSIGNED',
        qb_balance TEXT,
        qb_payment_status TEXT,
        source_payload TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_documents_project ON quickbooks_documents(project_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_documents_entity ON quickbooks_documents(qb_entity_type, qb_entity_id, qb_realm_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_cost_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quickbooks_document_id INTEGER NOT NULL,
        project_id INTEGER,
        cost_line_id INTEGER NOT NULL,
        amount_ex_vat TEXT NOT NULL,
        match_type TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'active',
        reason TEXT,
        created_by INTEGER,
        approved_by INTEGER,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_cost_allocations_doc ON quickbooks_cost_allocations(quickbooks_document_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_cost_allocations_line ON quickbooks_cost_allocations(cost_line_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_customer_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        client_id INTEGER,
        qb_realm_id TEXT NOT NULL,
        qb_customer_id TEXT NOT NULL,
        qb_customer_name TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        confidence TEXT,
        notes TEXT,
        locked_at TEXT,
        locked_by INTEGER,
        suggestion_run_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    for (const [column, definition] of [
      ["client_id", "INTEGER"],
      ["notes", "TEXT"],
      ["locked_at", "TEXT"],
      ["locked_by", "INTEGER"],
      ["suggestion_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("quickbooks_customer_mappings", column, definition);
    }
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_vendor_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qb_vendor_id TEXT NOT NULL,
        qb_vendor_name TEXT,
        qb_realm_id TEXT NOT NULL,
        counterparty_id INTEGER,
        counterparty_name TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        confidence TEXT,
        notes TEXT,
        locked_at TEXT,
        locked_by INTEGER,
        suggestion_run_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    for (const [column, definition] of [
      ["notes", "TEXT"],
      ["locked_at", "TEXT"],
      ["locked_by", "INTEGER"],
      ["suggestion_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("quickbooks_vendor_mappings", column, definition);
    }

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_invoice_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        app_entity_type TEXT NOT NULL,
        app_entity_id INTEGER NOT NULL,
        qb_entity_type TEXT NOT NULL,
        qb_entity_id TEXT NOT NULL,
        qb_realm_id TEXT NOT NULL,
        qb_doc_number TEXT,
        qb_txn_date TEXT,
        qb_amount TEXT,
        qb_counterparty_name TEXT,
        match_type TEXT NOT NULL DEFAULT 'manual',
        allocated_amount_ex_vat TEXT NOT NULL,
        allocation_tolerance_applied INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        confirmed_by INTEGER,
        confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_invoice_links_project ON quickbooks_invoice_links(project_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_invoice_links_app ON quickbooks_invoice_links(app_entity_type, app_entity_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_invoice_links_qb ON quickbooks_invoice_links(qb_entity_type, qb_entity_id, qb_realm_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_link_proposed_cascades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL,
        project_id INTEGER,
        target_table TEXT NOT NULL,
        target_id INTEGER,
        proposal_type TEXT NOT NULL,
        field_name TEXT,
        app_value TEXT,
        qb_value TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by INTEGER,
        resolved_by INTEGER,
        resolved_at TEXT,
        resolution_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS qb_link_proposed_cascades_unique_pending_idx
        ON qb_link_proposed_cascades(link_id, proposal_type, field_name)
        WHERE status = 'pending' AND deleted_at IS NULL
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS qb_link_proposed_cascades_link_idx ON qb_link_proposed_cascades(link_id)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS qb_link_proposed_cascades_status_idx ON qb_link_proposed_cascades(status)`));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS qb_link_proposed_cascades_project_idx ON qb_link_proposed_cascades(project_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_link_proposed_cascade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cascade_id INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        changed_by_user_id INTEGER,
        changed_by_role TEXT,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        details_json TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS qlpch_cascade_id_idx ON qb_link_proposed_cascade_history(cascade_id, changed_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS quickbooks_match_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        qb_realm_id TEXT NOT NULL,
        app_entity_id INTEGER,
        app_entity_label TEXT,
        candidates TEXT NOT NULL,
        requested_by INTEGER,
        requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        accepted_at TEXT,
        accepted_by INTEGER,
        accepted_qb_id TEXT,
        accepted_confidence TEXT,
        rejected_at TEXT,
        rejected_by INTEGER,
        rejection_reason TEXT,
        manual_override INTEGER NOT NULL DEFAULT 0,
        auto_generated INTEGER NOT NULL DEFAULT 0
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_quickbooks_match_suggestions_scope ON quickbooks_match_suggestions(scope, qb_realm_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS change_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_role TEXT,
        actor_user_id INTEGER,
        source TEXT NOT NULL DEFAULT 'manual',
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        project_id INTEGER,
        project_name TEXT,
        import_run_id INTEGER,
        smart_import_run_id INTEGER,
        action TEXT NOT NULL,
        summary TEXT,
        override_category TEXT,
        override_comment TEXT,
        correlation_id TEXT,
        file_metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS field_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_set_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        data_type TEXT DEFAULT 'text'
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_recon_ignores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qb_bill_id TEXT NOT NULL,
        qb_line_id TEXT,
        qb_doc_number TEXT,
        vendor_name TEXT,
        line_amount_ex_vat TEXT,
        resolved_project_name TEXT,
        reason TEXT NOT NULL,
        ignored_by_user_id INTEGER,
        ignored_by_name TEXT,
        ignored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_class_project_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_ref_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        note TEXT,
        created_by_user_id INTEGER,
        created_by_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_revenue_recon_ignores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qb_invoice_id TEXT NOT NULL,
        qb_line_id TEXT,
        qb_doc_number TEXT,
        customer_name TEXT,
        line_amount_ex_vat TEXT,
        resolved_project_name TEXT,
        reason TEXT NOT NULL,
        ignored_by_user_id INTEGER,
        ignored_by_name TEXT,
        ignored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qb_customer_project_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_ref_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        note TEXT,
        created_by_user_id INTEGER,
        created_by_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        project_id INTEGER,
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
        sort_order INTEGER DEFAULT 0,
        estimate_minutes INTEGER,
        task_category TEXT,
        is_recurring INTEGER DEFAULT 0,
        recurrence_frequency TEXT,
        recurrence_interval INTEGER DEFAULT 1,
        recurrence_days_of_week TEXT,
        recurrence_end_date TEXT,
        recurrence_parent_id INTEGER,
        sub_project_name TEXT,
        engineering_ticket_id INTEGER,
        bucket TEXT,
        pinned_today INTEGER DEFAULT 0,
        pinned_week INTEGER DEFAULT 0,
        source_email_id TEXT,
        source_email_subject TEXT,
        next_step TEXT,
        definition_of_done TEXT,
        completion_note TEXT,
        funding_type TEXT,
        size_kwp REAL,
        province TEXT,
        gps_coordinates TEXT,
        batteries_needed INTEGER DEFAULT 0,
        battery_size REAL,
        lead TEXT,
        resource_1 TEXT,
        resource_2 TEXT,
        tracker_comments TEXT,
        work_days INTEGER,
        cell_format TEXT,
        row_hash TEXT,
        import_snapshot TEXT,
        manual_overrides TEXT
      )
    `);
    await ensureSqliteWorkItemsProjectNullable();
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project_id, deleted_at)`);

    // Canonical work_items columns that older local SQLite databases may lack.
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN hold_reason TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN blocked_type TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN linked_plan_item_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN linked_deliverable_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN linked_quality_item_instance_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN completed_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN tracking_rag TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN task_type_tag TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN blocker_reason TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN estimate_minutes INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN task_category TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN is_recurring INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN recurrence_frequency TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN recurrence_interval INTEGER DEFAULT 1`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN recurrence_days_of_week TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN recurrence_end_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN recurrence_parent_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN sub_project_name TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN engineering_ticket_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN bucket TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN pinned_today INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN pinned_week INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN source_email_id TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN source_email_subject TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN next_step TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN definition_of_done TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN completion_note TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN funding_type TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN size_kwp REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN province TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN gps_coordinates TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN batteries_needed INTEGER DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN battery_size REAL`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN lead TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN resource_1 TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN resource_2 TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN tracker_comments TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN work_days INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN cell_format TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN row_hash TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN import_snapshot TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE work_items ADD COLUMN manual_overrides TEXT`)); } catch {}

    // work_item_status_history — append-only audit trail for work-item
    // status transitions. Created lazily here so the SQLite dev/test
    // fallback can exercise code paths that INSERT into it (e.g.
    // POST /api/priorities/tasks, status-change flows).
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        old_status TEXT,
        new_status TEXT NOT NULL,
        changed_by INTEGER,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_wish_work_item ON work_item_status_history(work_item_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_pm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL UNIQUE,
        duration INTEGER,
        percent_complete REAL DEFAULT 0,
        expected_pct_complete REAL,
        phase TEXT,
        is_milestone INTEGER DEFAULT 0,
        indent_level INTEGER DEFAULT 0,
        owner_name TEXT,
        is_shared INTEGER NOT NULL DEFAULT 0,
        hold_reason TEXT,
        blocked_type TEXT,
        blocker_reason TEXT,
        approval_required INTEGER NOT NULL DEFAULT 0,
        tracking_rag TEXT,
        task_type_tag TEXT,
        sub_project_name TEXT,
        completed_at TEXT,
        linked_plan_item_id INTEGER,
        linked_deliverable_id INTEGER,
        linked_quality_item_instance_id INTEGER
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_engineering (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL UNIQUE,
        wbs_code TEXT,
        outline_number TEXT,
        legacy_table TEXT,
        legacy_id INTEGER,
        source_row INTEGER,
        source_sheet TEXT,
        import_run_id INTEGER
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_scheduling (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL UNIQUE,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT,
        estimate_minutes INTEGER,
        task_category TEXT,
        baseline_start TEXT,
        baseline_end TEXT,
        baseline_duration INTEGER,
        task_mode TEXT DEFAULT 'auto'
      )
    `));

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

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        author_id INTEGER,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_task_comments_work_item ON task_comments(work_item_id, created_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS task_deliverables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size INTEGER,
        note TEXT,
        sent_by_user_id INTEGER NOT NULL,
        recipient_user_id INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_task_deliverables_work_item ON task_deliverables(work_item_id)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS task_activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        actor_id INTEGER,
        action_type TEXT NOT NULL,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    try { await db.run(sql.raw(`ALTER TABLE task_activity_log ADD COLUMN field_name TEXT`)); } catch {}
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_task_activity_log_work_item ON task_activity_log(work_item_id, created_at)`));

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS work_item_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        predecessor_id INTEGER NOT NULL,
        successor_id INTEGER NOT NULL,
        dep_type TEXT NOT NULL DEFAULT 'FS',
        lag_days INTEGER DEFAULT 0,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_predecessor ON work_item_dependencies(predecessor_id, deleted_at)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_successor ON work_item_dependencies(successor_id, deleted_at)`);

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS tr_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tr_id TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        action_description TEXT NOT NULL,
        rag_status TEXT NOT NULL DEFAULT 'green',
        owners TEXT NOT NULL DEFAULT '[]',
        owner_user_ids TEXT,
        support TEXT NOT NULL DEFAULT '[]',
        date_raised TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        date_completed TEXT,
        outcome_comments TEXT,
        supporting_info TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT
      )
    `));

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
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN approval_type TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN urgency TEXT NOT NULL DEFAULT 'normal'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN evidence_links TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN scheduled_date TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN scheduled_start_time TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN scheduled_end_time TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN deleted_at TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN deleted_by INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN delete_reason TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN override_role TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE approvals ADD COLUMN submitted_at TEXT`)); } catch {}

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS procurement_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        quantity TEXT,
        unit TEXT,
        expected_cost TEXT,
        actual_cost TEXT,
        supplier_id INTEGER,
        requested_by_user_id INTEGER,
        owner_user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'requested',
        required_date TEXT,
        po_id INTEGER,
        invoice_ref TEXT,
        linked_invoice_capture_id INTEGER,
        budget_line TEXT,
        linked_deliverable_id INTEGER,
        linked_milestone TEXT,
        progress_percent REAL,
        receipt_ref TEXT,
        payment_status TEXT NOT NULL DEFAULT 'not_applicable',
        linked_task_id INTEGER,
        approval_id INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        requisition_status TEXT DEFAULT 'none',
        rfq_sent_date TEXT,
        quote_received_date TEXT,
        quote_amount TEXT,
        boq_reference TEXT,
        delivery_expected_date TEXT,
        delivery_actual_date TEXT,
        delivery_status TEXT DEFAULT 'not_ordered',
        is_long_lead INTEGER DEFAULT 0,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_procurement_items_project ON procurement_items(project_id, deleted_at)`));

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
        project_id INTEGER,
        correlation_id TEXT,
        ip_address TEXT,
        request_path TEXT,
        request_method TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await db.run(sql.raw(`ALTER TABLE audit_events ADD COLUMN project_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE audit_events ADD COLUMN correlation_id TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE audit_events ADD COLUMN ip_address TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE audit_events ADD COLUMN request_path TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE audit_events ADD COLUMN request_method TEXT`)); } catch {}
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_name, created_at)`);

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor_user_id INTEGER,
        actor_role TEXT,
        source_entity_type TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        visibility TEXT DEFAULT '{"scope":"project"}',
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, idempotency_key)
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_project_events_project_time ON project_events(project_id, event_timestamp)`));

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
        deadline_timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        deleted_by INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Add deleted_at/deleted_by to existing standup_schedules tables
    try { await db.run(sql`ALTER TABLE standup_schedules ADD COLUMN deleted_at TEXT`); } catch (_e) { /* column already exists */ }
    try { await db.run(sql`ALTER TABLE standup_schedules ADD COLUMN deleted_by INTEGER`); } catch (_e) { /* column already exists */ }

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
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_standup_entries_unique_schedule_user_date ON standup_entries(schedule_id, user_id, standup_date)`);
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
        captured_at TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_from TEXT DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER
      )
    `);
    for (const [column, definition] of [
      ["effective_from", "TEXT DEFAULT CURRENT_TIMESTAMP"],
      ["effective_to", "TEXT"],
      ["snapshot_run_id", "INTEGER"],
    ] as const) {
      await ensureSqliteColumn("project_revenue_summary", column, definition);
    }

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS tracker_revenue_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        import_run_id INTEGER NOT NULL,
        planned_revenue_costed TEXT,
        planned_revenue_actual TEXT,
        planned_expenditure_costed TEXT,
        planned_expenditure_actual TEXT,
        planned_profit_costed TEXT,
        planned_profit_actual TEXT,
        planned_margin_costed TEXT,
        planned_margin_actual TEXT,
        cell_format TEXT,
        source_sheet TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tracker_revenue_summary_project ON tracker_revenue_summary(project_id, effective_to)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS tracker_project_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        import_run_id INTEGER NOT NULL,
        baseline_completion_date TEXT,
        forecasted_completion_date TEXT,
        project_start_date TEXT,
        duration_months_from_site_estab TEXT,
        duration_months_to_capacity_test TEXT,
        cell_format TEXT,
        source_sheet TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_to TEXT,
        snapshot_run_id INTEGER
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tracker_project_metadata_project ON tracker_project_metadata(project_id, effective_to)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS financial_edit_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        requested_by_user_id INTEGER NOT NULL,
        edit_type TEXT NOT NULL,
        edit_target TEXT NOT NULL,
        edit_payload TEXT NOT NULL,
        edit_summary TEXT NOT NULL,
        is_critical_path INTEGER NOT NULL DEFAULT 0,
        affects_revenue INTEGER NOT NULL DEFAULT 0,
        affects_expenditure INTEGER NOT NULL DEFAULT 0,
        affects_quality INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER,
        review_comment TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS financial_integration_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        rule_type TEXT NOT NULL,
        rule_config TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        created_by_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_template_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase_id INTEGER,
        item_name TEXT,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        project_name TEXT,
        template_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_item_instance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checklist_id INTEGER NOT NULL,
        template_item_id INTEGER NOT NULL,
        is_applicable INTEGER NOT NULL DEFAULT 1,
        start_date TEXT,
        end_date TEXT,
        approved INTEGER NOT NULL DEFAULT 0,
        approved_by_user_id INTEGER,
        approved_at TEXT,
        approval_comment TEXT,
        not_applicable_reason TEXT,
        working_days INTEGER,
        allowed_working_days INTEGER,
        qm_status TEXT NOT NULL DEFAULT 'not_started',
        assignee_user_id INTEGER,
        last_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT
      )
    `));
    await ensureSqliteColumn("qc_template_item", "template_group_id", "INTEGER");
    await ensureSqliteColumn("qc_template_item", "is_evidence_required", "INTEGER NOT NULL DEFAULT 0");
    await ensureSqliteColumn("qc_template_item", "default_severity", "TEXT NOT NULL DEFAULT 'Medium'");
    await ensureSqliteColumn("qc_checklist", "project_id", "INTEGER");
    await ensureSqliteColumn("qc_checklist", "project_name", "TEXT NOT NULL DEFAULT ''");
    await ensureSqliteColumn("qc_checklist", "template_id", "INTEGER");
    await ensureSqliteColumn("qc_item_instance", "template_item_id", "INTEGER");
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_item_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        item_instance_id INTEGER NOT NULL,
        evidence_url TEXT NOT NULL,
        evidence_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_qc_item_evidence_item ON qc_item_evidence(item_instance_id)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_template_risk_question (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_phase_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        response_type TEXT NOT NULL DEFAULT 'yesno',
        triggers_warning INTEGER NOT NULL DEFAULT 0,
        trigger_condition TEXT DEFAULT 'yes',
        trigger_severity TEXT DEFAULT 'Medium'
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_risk_answer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checklist_id INTEGER NOT NULL,
        template_risk_question_id INTEGER NOT NULL,
        answer_yesno INTEGER,
        answer_text TEXT,
        answer_number REAL,
        last_updated_by INTEGER,
        last_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_qc_risk_answer_checklist ON qc_risk_answer(checklist_id)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_plan_link (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        plan_item_id INTEGER NOT NULL,
        item_instance_id INTEGER,
        phase_id INTEGER,
        link_type TEXT NOT NULL DEFAULT 'phase_task',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_qc_plan_link_project ON qc_plan_link(project_id, project_name)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_warning (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        severity TEXT NOT NULL DEFAULT 'Medium',
        warning_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        related_plan_item_id INTEGER,
        related_item_instance_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        owner_user_id INTEGER,
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_qc_warning_project_status ON qc_warning(project_id, status)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_warning_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warning_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        note TEXT,
        actor_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_qc_warning_event_warning ON qc_warning_event(warning_id)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_template_postmortem_metric (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        input_type TEXT NOT NULL DEFAULT 'count',
        scoring_rule_json TEXT,
        metric_group TEXT NOT NULL DEFAULT 'contractor_quality'
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_postmortem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        completed_at TEXT,
        completed_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_postmortem_metric_value (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postmortem_id INTEGER NOT NULL,
        template_metric_id INTEGER NOT NULL,
        input_value_number REAL,
        input_value_choice TEXT,
        score REAL
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_postmortem_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postmortem_id INTEGER NOT NULL,
        contractor_quality_score REAL,
        engineering_quality_score REAL,
        red_flag INTEGER NOT NULL DEFAULT 0
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS qc_access_challenge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        last_success_at TEXT,
        failed_attempts_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS ncr_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        phase_at_raise_time TEXT,
        subcontractor_id INTEGER,
        related_checklist_item_id INTEGER,
        reported_by INTEGER NOT NULL,
        assigned_to INTEGER,
        closed_by_user_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'major',
        status TEXT NOT NULL DEFAULT 'open',
        root_cause TEXT,
        corrective_action TEXT,
        preventive_action TEXT,
        waiver_reason TEXT,
        due_date TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ncr_reports_project_status ON ncr_reports(project_id, status)`));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS ncr_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ncr_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        uploaded_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS ncr_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ncr_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS priority_derived_metrics (
        priority_id INTEGER PRIMARY KEY,
        project_count INTEGER NOT NULL DEFAULT 0,
        at_risk_project_count INTEGER NOT NULL DEFAULT 0,
        derived_health TEXT,
        total_revenue REAL NOT NULL DEFAULT 0,
        total_cos REAL NOT NULL DEFAULT 0,
        total_gp REAL NOT NULL DEFAULT 0,
        avg_progress REAL NOT NULL DEFAULT 0,
        blocker_count INTEGER NOT NULL DEFAULT 0,
        open_task_count INTEGER NOT NULL DEFAULT 0,
        eng_blocker_count INTEGER NOT NULL DEFAULT 0,
        quality_defect_count INTEGER NOT NULL DEFAULT 0,
        hse_incident_count INTEGER NOT NULL DEFAULT 0,
        hse_critical_count INTEGER NOT NULL DEFAULT 0,
        opportunity_count INTEGER NOT NULL DEFAULT 0,
        stale_opportunity_count INTEGER NOT NULL DEFAULT 0,
        open_pd_ticket_count INTEGER NOT NULL DEFAULT 0
      )
    `));
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

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS engineering_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        client_name_snapshot TEXT,
        project_id INTEGER,
        opportunity_id INTEGER,
        project_site_name TEXT NOT NULL,
        due_date TEXT,
        request_type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'Medium',
        status TEXT NOT NULL DEFAULT 'to_do',
        number_of_reworks INTEGER NOT NULL DEFAULT 0,
        project_developer_user_id INTEGER,
        designer_user_id INTEGER,
        funding_type TEXT,
        size_kwp TEXT,
        province TEXT,
        gps_coordinates TEXT,
        bills_or_tariff_data INTEGER DEFAULT 0,
        metering_data_available INTEGER DEFAULT 0,
        site_inspection_form INTEGER DEFAULT 0,
        site_inspection_link TEXT,
        working_schedule TEXT,
        batteries_needed INTEGER DEFAULT 0,
        battery_size TEXT,
        diesel_gen_integration INTEGER DEFAULT 0,
        roof_replacement_needed INTEGER DEFAULT 0,
        hse_discussed INTEGER DEFAULT 0,
        comments TEXT,
        estimated_project_value TEXT,
        estimated_cost TEXT,
        estimated_margin TEXT,
        estimated_margin_percent TEXT,
        financial_notes TEXT,
        clickup_synced INTEGER DEFAULT 0,
        tasks_spawned_at TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_engineering_tickets_project ON engineering_tickets(project_id, deleted_at)`));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS eng_stage_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        purpose TEXT,
        inputs TEXT,
        raci_responsible TEXT,
        raci_accountable TEXT,
        raci_consulted TEXT,
        raci_informed TEXT,
        failure_modes TEXT,
        stage_gate_rules TEXT,
        definition_of_done TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS eng_task_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_template_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        is_required INTEGER NOT NULL DEFAULT 1,
        sequence INTEGER NOT NULL DEFAULT 0,
        default_owner_role TEXT,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS eng_deliverable_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_template_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_required INTEGER NOT NULL DEFAULT 1,
        allowed_file_types TEXT,
        required_count INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        deleted_by INTEGER
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_eng_stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        stage_template_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_started',
        started_at TEXT,
        completed_at TEXT,
        ifc_issued_at TEXT,
        handover_ready_at TEXT,
        override_reason TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_eng_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_eng_stage_id INTEGER NOT NULL,
        task_template_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        owner_user_id INTEGER,
        notes TEXT,
        due_date TEXT,
        completed_at TEXT,
        completed_by INTEGER,
        has_deliverable INTEGER NOT NULL DEFAULT 0,
        work_item_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_eng_deliverables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_eng_stage_id INTEGER NOT NULL,
        deliverable_template_id INTEGER,
        project_eng_task_id INTEGER,
        file_name TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        storage_ref TEXT NOT NULL,
        uploaded_by INTEGER,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        version_tag TEXT,
        notes TEXT,
        sharepoint_folder_path TEXT,
        approval_status TEXT DEFAULT 'pending',
        approved_by INTEGER,
        approved_at TEXT,
        released_for TEXT NOT NULL DEFAULT 'draft',
        issued_for_construction_at TEXT,
        issued_for_construction_by INTEGER,
        as_built_at TEXT,
        as_built_by INTEGER,
        superseded_by_id INTEGER
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_eng_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_eng_stage_id INTEGER NOT NULL,
        approver_role TEXT NOT NULL,
        approver_user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        comments TEXT,
        scheduled_date TEXT,
        scheduled_start_time TEXT,
        scheduled_end_time TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS hse_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        site_id INTEGER,
        incident_date TEXT NOT NULL,
        incident_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT NOT NULL,
        reported_by_user_id INTEGER,
        location TEXT,
        root_cause TEXT,
        immediate_actions TEXT,
        status TEXT DEFAULT 'open',
        evidence_link TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS corrective_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        project_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        assigned_to_user_id INTEGER,
        due_date TEXT,
        status TEXT DEFAULT 'open',
        completion_date TEXT,
        evidence_link TEXT,
        verified_by_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS sp_list_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        list_id TEXT NOT NULL,
        site_name TEXT,
        list_name TEXT,
        site_url TEXT,
        column_mapping_json TEXT,
        field_ownership_json TEXT,
        last_pulled_at TEXT,
        last_pushed_at TEXT,
        last_delta_token TEXT,
        sync_view_filter TEXT DEFAULT 'IN PROGRESS',
        configured_by_role TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS mock_sp_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mock_item_id TEXT NOT NULL UNIQUE,
        fields TEXT NOT NULL,
        etag TEXT,
        created_date_time TEXT,
        last_modified_date_time TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      INSERT OR IGNORE INTO mock_sp_items (mock_item_id, fields, etag, created_date_time, last_modified_date_time)
      VALUES
        ('MOCK-001', '{"Title":"Gateway Mall First Assessment","Client":"Gateway Mall","DueDate":"2026-06-05","Request_x0020_Type":"First Assessment","Priority":"High","Status":"New","Number_x0020_of_x0020_Reworks":0,"Project_x0020_Developer":"PD Team","Designer":"Design Team","Size_x0020_in_x0020_kWp":850,"Province":"Gauteng","GPS":"-26.2041,28.0473","Funding_x0020_Type":"PPA","Comments":"Initial intake item","Working_x0020_schedule":"Weekdays","Batteries_x0020_needed":"TBD","ClickUpSynced":"No","Days_x0020_in_x0020_progress":0}', '"mock-etag-MOCK-001"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('MOCK-002', '{"Title":"Retail Park Cost Proposal","Client":"Retail Park","DueDate":"2026-06-12","Request_x0020_Type":"Cost Proposal","Priority":"Medium","Status":"In Progress","Number_x0020_of_x0020_Reworks":1,"Project_x0020_Developer":"PD Team","Designer":"Design Team","Size_x0020_in_x0020_kWp":420,"Province":"Western Cape","GPS":"-33.9249,18.4241","Funding_x0020_Type":"PPA, Rental","Comments":"Multi funding option","Working_x0020_schedule":"Weekdays","Batteries_x0020_needed":"No","ClickUpSynced":"No","Days_x0020_in_x0020_progress":3}', '"mock-etag-MOCK-002"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('MOCK-003', '{"Title":"Warehouse Meter Installation","Client":"Warehouse Co","DueDate":"2026-06-19","Request_x0020_Type":"Meter Installation","Priority":"Low","Status":"Awaiting CP","Number_x0020_of_x0020_Reworks":0,"Project_x0020_Developer":"PD Team","Designer":"Design Team","Size_x0020_in_x0020_kWp":275,"Province":"KwaZulu-Natal","GPS":"","Funding_x0020_Type":"Cash","Comments":"GPS pending from client","Working_x0020_schedule":"Weekdays","Batteries_x0020_needed":"No","ClickUpSynced":"No","Days_x0020_in_x0020_progress":7}', '"mock-etag-MOCK-003"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('MOCK-004', '{"Title":"Factory Site Visit Report","Client":"Factory Holdings","DueDate":"2026-06-01","Request_x0020_Type":"Site Visit Report","Priority":"Critical","Status":"Blocked","Number_x0020_of_x0020_Reworks":2,"Project_x0020_Developer":"PD Team","Designer":"Design Team","Size_x0020_in_x0020_kWp":1200,"Province":"Limpopo","GPS":"-23.9045,29.4689","Funding_x0020_Type":"Lease","Comments":"BLOCKED: waiting for transformer information","Working_x0020_schedule":"Weekdays","Batteries_x0020_needed":"Yes","ClickUpSynced":"No","Days_x0020_in_x0020_progress":14}', '"mock-etag-MOCK-004"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS intake_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sp_item_id TEXT NOT NULL UNIQUE,
        project_id INTEGER,
        client_key TEXT NOT NULL,
        client_name TEXT NOT NULL,
        request_type TEXT,
        status TEXT,
        priority TEXT,
        due_date TEXT,
        days_in_progress INTEGER,
        project_developer TEXT,
        designer TEXT,
        size_kwp TEXT,
        province TEXT,
        gps_coordinates TEXT,
        funding_type TEXT,
        bills_tariff_data TEXT,
        metering_data TEXT,
        site_inspection_form TEXT,
        comments TEXT,
        working_schedule TEXT,
        batteries_needed TEXT,
        battery_size TEXT,
        diesel_gen_needed TEXT,
        roof_replacement_needed TEXT,
        hse_discussed TEXT,
        number_of_reworks INTEGER,
        clickup_synced TEXT,
        item_type TEXT,
        sp_path TEXT,
        sp_etag TEXT,
        sp_raw_json TEXT,
        app_notes TEXT,
        app_internal_blockers TEXT,
        cp_signed INTEGER NOT NULL DEFAULT 0,
        cp_signed_date TEXT,
        cp_signed_by TEXT,
        cp_evidence_type TEXT,
        cp_evidence_ref TEXT,
        pm_created INTEGER NOT NULL DEFAULT 0,
        tasks_generated INTEGER NOT NULL DEFAULT 0,
        last_pulled_at TEXT,
        last_pushed_at TEXT,
        last_pulled_hash TEXT,
        last_app_edit_at TEXT,
        sync_conflict INTEGER NOT NULL DEFAULT 0,
        conflict_fields_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS intake_task_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        dod_items TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS intake_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        intake_request_id INTEGER NOT NULL,
        template_item_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED',
        dod_items TEXT,
        dod_completed_json TEXT,
        assigned_to TEXT,
        due_date TEXT,
        completed_at TEXT,
        completed_by TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS sync_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        direction TEXT NOT NULL,
        summary TEXT,
        errors_json TEXT,
        conflicts_json TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        new_projects_count INTEGER NOT NULL DEFAULT 0,
        new_requests_count INTEGER NOT NULL DEFAULT 0,
        updated_requests_count INTEGER NOT NULL DEFAULT 0,
        conflict_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        conflicts_count INTEGER NOT NULL DEFAULT 0,
        errors_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_ref TEXT NOT NULL UNIQUE,
        po_number INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        project_id INTEGER,
        supplier_name TEXT NOT NULL,
        supplier_vat TEXT,
        supplier_address TEXT,
        supplier_contact TEXT,
        line_items TEXT NOT NULL DEFAULT '[]',
        subtotal TEXT NOT NULL DEFAULT '0',
        vat_amount TEXT NOT NULL DEFAULT '0',
        total TEXT NOT NULL DEFAULT '0',
        payment_terms TEXT,
        delivery_date TEXT,
        delivery_address TEXT,
        site_contact TEXT,
        comments TEXT,
        project_manager TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sent_at TEXT,
        pdf_data TEXT,
        idempotency_key TEXT
      )
    `));
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS po_review_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_order_id INTEGER NOT NULL,
        reviewer_user_id INTEGER NOT NULL,
        reviewer_role TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        decided_at TEXT,
        notes TEXT,
        delegated_to_user_id INTEGER,
        delegated_at TEXT,
        delegation_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_pd_pm_handover (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        handover_status_text TEXT,
        pd_owner TEXT,
        pm_owner TEXT,
        summary TEXT,
        risks TEXT,
        assumptions TEXT,
        engineering_status TEXT,
        quality_status TEXT,
        notes_to_pm TEXT,
        handover_summary TEXT,
        deliverables TEXT NOT NULL DEFAULT '{}',
        submitted_by TEXT,
        submitted_at TEXT,
        accepted_by TEXT,
        accepted_at TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        rejection_reason TEXT,
        feasibility_status TEXT,
        feasibility_notes TEXT,
        dependency_summary TEXT,
        handover_readiness_status TEXT,
        handover_readiness_notes TEXT,
        handover_form_data TEXT DEFAULT '{}',
        readiness_checklist TEXT DEFAULT '{}',
        readiness_score INTEGER DEFAULT 0,
        pd_sign_off_at TEXT,
        pd_sign_off_by TEXT,
        pm_sign_off_at TEXT,
        pm_sign_off_by TEXT,
        kickoff_date TEXT,
        lessons_reviewed INTEGER DEFAULT 0,
        version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS fye_report_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fye_year INTEGER NOT NULL,
        snapshot_month INTEGER NOT NULL,
        snapshot_date TEXT NOT NULL,
        snapshot_label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot_data TEXT NOT NULL,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        submitted_by INTEGER,
        submitted_at TEXT,
        approved_by INTEGER,
        approved_at TEXT
      )
    `);

    // Add fye_year and created_by to forecast_pipeline and lost_deals
    try { await db.run(sql.raw(`ALTER TABLE forecast_pipeline ADD COLUMN fye_year INTEGER NOT NULL DEFAULT 2026`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE forecast_pipeline ADD COLUMN created_by INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE lost_deals ADD COLUMN fye_year INTEGER NOT NULL DEFAULT 2026`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE lost_deals ADD COLUMN created_by INTEGER`)); } catch {}

    // Microsoft Sync tables (ms_accounts, ms_objects, project_links)
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS ms_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tenant_id TEXT NOT NULL,
        ms_user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        refresh_token_encrypted TEXT,
        sso_access_token TEXT,
        sso_token_expires_at TEXT,
        connected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active'
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS ms_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        ms_id TEXT NOT NULL,
        subject_or_title TEXT,
        preview TEXT,
        web_link TEXT,
        sender_or_organizer TEXT,
        received_or_start_datetime TEXT,
        end_datetime TEXT,
        last_synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
        action_required INTEGER DEFAULT 0,
        is_read INTEGER DEFAULT 1,
        importance TEXT,
        linked_project_id INTEGER,
        linked_task_id INTEGER,
        metadata TEXT,
        dismissed INTEGER DEFAULT 0
      )
    `);
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS ms_objects_user_type_msid ON ms_objects(user_id, type, ms_id)`);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ms_object_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        linked_by_user_id INTEGER NOT NULL,
        linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        note TEXT
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
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN pm_user_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN pd_user_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN site_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN opportunity_id INTEGER`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN delivery_model TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN project_code TEXT`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN project_status TEXT NOT NULL DEFAULT 'active'`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN in_dlp INTEGER NOT NULL DEFAULT 0`)); } catch {}
    try { await db.run(sql.raw(`ALTER TABLE project_info ADD COLUMN deleted_at TEXT`)); } catch {}

    console.log('[DB] SQLite schema verified');
  } catch (err: unknown) {
    console.error('[DB] Error creating SQLite schema:', (err instanceof Error ? err.message : String(err)));
  }
}

function getDbMode(): 'sqlite' | 'postgres' {
  return dbMode;
}

function getPostgresPool(): pg.Pool | null {
  return postgresPool;
}

export { db, dbMode, dbConfig, initializeDatabase, getDbMode, getPostgresPool };
