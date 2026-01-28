import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "@shared/schema";
import { resolveDbConfig } from "./db-config";

const config = resolveDbConfig();

let db: any;
let dbMode: 'sqlite' | 'postgres';
let dbConfig: typeof config;

if (config.mode === 'sqlite') {
  // SQLite fallback mode
  console.warn('[DB] Using SQLite fallback mode:', config.error);
  const sqlite = new BetterSqlite3(':memory:');
  db = drizzleSqlite(sqlite, { schema });
  dbMode = 'sqlite';
  dbConfig = config;
} else if (config.connectionString) {
  // PostgreSQL mode
  const pool = new pg.Pool({
    connectionString: config.connectionString,
  });
  
  // Test connection on startup
  pool.query('SELECT 1', (err) => {
    if (err) {
      console.error('[DB] PostgreSQL connection test failed:', err.message);
    } else {
      console.log('[DB] PostgreSQL connection successful');
    }
  });
  
  db = drizzle(pool, { schema });
  dbMode = 'postgres';
  dbConfig = config;
} else {
  throw new Error('Database configuration error: unable to resolve connection');
}

export { db, dbMode, dbConfig };
