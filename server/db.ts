import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { resolveDbConfig, setDbConfigStatus } from "./db-config";

const config = resolveDbConfig();

let db: any;
let dbMode: 'sqlite' | 'postgres';
let dbConfig: typeof config;

async function testPostgresConnection(connectionString: string, timeoutMs: number = 2000): Promise<boolean> {
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
  dbConfig = { mode: 'sqlite', error: config.error || 'Postgres unavailable' };
  
  setDbConfigStatus({
    connected: true,
    mode: 'sqlite',
    message: `Using SQLite fallback (${sqliteFile})`,
    host: undefined,
  });
}

// Initialize database - test Postgres first with timeout, fall back to SQLite
if (config.mode === 'postgres' && config.connectionString) {
  console.log(`[DB] Testing PostgreSQL connection to ${config.dbHost}...`);
  
  // Start with SQLite for immediate availability
  initializeSqlite();
  
  // Test Postgres in background, switch if successful
  testPostgresConnection(config.connectionString, 2000).then((isConnectable) => {
    if (isConnectable) {
      // Success - switch to Postgres
      const pool = new pg.Pool({ connectionString: config.connectionString });
      db = drizzle(pool, { schema });
      dbMode = 'postgres';
      dbConfig = config;
      
      console.log(`[DB] ✓ PostgreSQL connection successful, switched from SQLite (host: ${config.dbHost})`);
      setDbConfigStatus({
        connected: true,
        mode: 'postgres',
        message: `Connected to PostgreSQL (${config.dbHost})`,
        host: config.dbHost,
      });
    } else {
      // Connection test failed - keep using SQLite
      console.warn(`[DB] ⚠ PostgreSQL connection test failed (host: ${config.dbHost}), using SQLite`);
    }
  }).catch((err) => {
    console.error(`[DB] Postgres test error:`, err.message, '- using SQLite');
  });
} else {
  // No Postgres config - use SQLite
  initializeSqlite();
}

export { db, dbMode, dbConfig };
