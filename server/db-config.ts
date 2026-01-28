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
  // Priority 1: Use DATABASE_URL if present and host is NOT helium
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    
    // Extract hostname for diagnostics
    let dbHost = 'unknown';
    try {
      const urlObj = new URL(url);
      dbHost = urlObj.hostname;
      
      // Force SQLite for helium hosts (unreliable DNS/connection)
      if (dbHost.includes('helium')) {
        console.log(`[DB] Detected helium host (${dbHost}), forcing SQLite for stability`);
        return {
          mode: 'sqlite',
          error: `Helium host detected (${dbHost}), using SQLite for reliability`,
        };
      }
    } catch {}
    
    return {
      mode: 'postgres',
      connectionString: url,
      dbHost,
    };
  }

  // Priority 2: Build from PG environment variables (but avoid helium)
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER && PGDATABASE) {
    // Force SQLite for helium hosts
    if (PGHOST.includes('helium')) {
      console.log(`[DB] Detected helium PGHOST (${PGHOST}), forcing SQLite for stability`);
      return {
        mode: 'sqlite',
        error: `Helium PGHOST detected (${PGHOST}), using SQLite for reliability`,
      };
    }
    
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
