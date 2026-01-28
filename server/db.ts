import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { resolveDbConfig, setDbConfigStatus } from "./db-config";
import { sql } from "drizzle-orm";

const config = resolveDbConfig();

let db: any;
let dbMode: 'sqlite' | 'postgres';
let dbConfig: typeof config;
let isInitialized = false;

/**
 * Deterministic database initialization - selects DB ONCE and never switches
 */
async function initializeDatabase(): Promise<void> {
  if (isInitialized) return;
  
  if (config.mode === 'postgres' && config.connectionString) {
    // Try Postgres synchronously with timeout
    console.log(`[DB] Testing PostgreSQL connection to ${config.dbHost}...`);
    
    try {
      const isConnectable = await testPostgresConnection(config.connectionString, 2000);
      
      if (isConnectable) {
        // Use Postgres
        const pool = new pg.Pool({ connectionString: config.connectionString });
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
      } else {
        console.warn(`[DB] ⚠ PostgreSQL test failed (host: ${config.dbHost}), falling back to SQLite`);
      }
    } catch (err: any) {
      console.error(`[DB] Postgres connection error:`, err.message);
    }
  }
  
  // Use SQLite (either by config or because Postgres failed)
  initializeSqlite();
  await ensureSqliteSchema();
  isInitialized = true;
}

function testPostgresConnection(connectionString: string, timeoutMs: number = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: timeoutMs });
    const timeout = setTimeout(() => {
      pool.end();
      resolve(false);
    }, timeoutMs);
    
    pool.query('SELECT 1', (err) => {
      clearTimeout(timeout);
      pool.end();
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
  dbConfig = { mode: 'sqlite', error: config.error || 'SQLite selected' };
  
  setDbConfigStatus({
    connected: true,
    mode: 'sqlite',
    message: `Using SQLite (${sqliteFile})`,
    host: undefined,
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
    
    // Create other essential tables
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_info (
        project_name TEXT PRIMARY KEY,
        client TEXT,
        location TEXT,
        capacity_kwp REAL,
        project_type TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS program_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        category TEXT,
        item TEXT,
        supplier TEXT,
        status TEXT,
        total_amount REAL,
        paid_to_date REAL,
        balance REAL,
        payment_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS program_inflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        revenue_source TEXT,
        amount REAL,
        date_received TEXT,
        status TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS project_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        task_name TEXT,
        responsible TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS cashflow_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        series_name TEXT NOT NULL,
        period_label TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_revenue_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        month_label TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS finance_cos_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        month_label TEXT NOT NULL,
        value REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
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
    
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS refresh_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        triggered_by INTEGER,
        status TEXT DEFAULT 'success',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('[DB] ✓ SQLite schema verified');
  } catch (err: any) {
    console.error('[DB] Error creating SQLite schema:', err.message);
  }
}

export { db, dbMode, dbConfig, initializeDatabase };
