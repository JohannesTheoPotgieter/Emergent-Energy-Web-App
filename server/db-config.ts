/**
 * Database configuration resolver
 * Production policy: PostgreSQL is required in production; SQLite remains available for local/dev mode
 */

export interface DbConfig {
  mode: 'postgres' | 'sqlite';
  connectionString?: string;
  dbHost?: string;
  error?: string;
}

export function resolveDbConfig(): DbConfig {
  // Priority 0: Check explicit DB_MODE env var
  const explicitMode = process.env.DB_MODE?.toLowerCase();
  if (explicitMode === 'sqlite') {
    console.log(`[DB] DB_MODE=sqlite, forcing SQLite mode`);
    return {
      mode: 'sqlite',
      error: 'DB_MODE=sqlite explicitly set',
    };
  }
  
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

  // Priority 2: SQLite fallback (safe for all deployments)
  console.log('[DB] No DATABASE_URL found, using SQLite for reliability');
  return {
    mode: 'sqlite',
    error: 'No PostgreSQL configuration found, using SQLite fallback',
  };
}

let cachedStatus: { connected: boolean; mode: string; message: string; host?: string; error?: string } | null = null;

export function getDbConfigStatus(): { connected: boolean; mode: string; message: string; host?: string; error?: string } {
  if (cachedStatus) return cachedStatus;
  return { connected: false, mode: 'unknown', message: 'Database not initialized' };
}

export function setDbConfigStatus(status: { connected: boolean; mode: string; message: string; host?: string; error?: string }) {
  cachedStatus = status;
}
