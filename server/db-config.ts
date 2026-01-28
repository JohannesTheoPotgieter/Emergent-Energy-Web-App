/**
 * Database configuration resolver
 * Handles multiple deployment scenarios with proper fallbacks
 */

export interface DbConfig {
  mode: 'postgres' | 'sqlite';
  connectionString?: string;
  dbHost?: string;
  error?: string;
}

export function resolveDbConfig(): DbConfig {
  // Priority 1: Use DATABASE_URL if present
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    
    // Extract hostname for diagnostics
    let dbHost = 'unknown';
    try {
      const urlObj = new URL(url);
      dbHost = urlObj.hostname;
    } catch {}
    
    return {
      mode: 'postgres',
      connectionString: url,
      dbHost,
    };
  }

  // Priority 2: Build from PG environment variables
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER && PGDATABASE) {
    const port = PGPORT || '5432';
    const password = PGPASSWORD ? `:${PGPASSWORD}` : '';
    const connectionString = `postgresql://${PGUSER}${password}@${PGHOST}:${port}/${PGDATABASE}`;
    
    return {
      mode: 'postgres',
      connectionString,
      dbHost: PGHOST,
    };
  }

  // Priority 3: SQLite fallback for deployments (no network dependencies)
  return {
    mode: 'sqlite',
    error: 'No PostgreSQL configuration found, using SQLite fallback',
  };
}

let cachedStatus: { connected: boolean; mode: string; message: string; host?: string } | null = null;

export function getDbConfigStatus(): { connected: boolean; mode: string; message: string; host?: string } {
  if (cachedStatus) return cachedStatus;
  return { connected: false, mode: 'unknown', message: 'Database not initialized' };
}

export function setDbConfigStatus(status: { connected: boolean; mode: string; message: string; host?: string }) {
  cachedStatus = status;
}
