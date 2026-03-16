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
  if (startupSchemaRepairEnabled) {
    console.log('[DB] Startup schema repair enabled - running SQLite schema repair');
    await ensureSqliteSchema();
  } else {
    console.log('[DB] Startup schema repair disabled - skipping SQLite schema repair (safe mode)');
  }
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
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
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
    
    console.log('[DB] ✓ SQLite schema verified');
  } catch (err: any) {
    console.error('[DB] Error creating SQLite schema:', err.message);
  }
}

function getDbMode(): 'sqlite' | 'postgres' {
  return dbMode;
}

export { db, dbMode, dbConfig, initializeDatabase, getDbMode };
