/**
 * Database configuration resolver
 * Production policy: PostgreSQL is required in production; SQLite remains available for local/dev mode
 */

export interface DbConfig {
  mode: 'postgres' | 'sqlite';
  connectionString?: string;
  dbHost?: string;
  error?: string;
  strictMode: boolean;
}

function isStrictRuntimeEnvironment() {
  return process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
}

export function resolveDbConfig(): DbConfig {
  const strictMode = isStrictRuntimeEnvironment();
  // Priority 0: Check explicit DB_MODE env var
  const explicitMode = process.env.DB_MODE?.toLowerCase();
  if (explicitMode === 'sqlite') {
    if (strictMode) {
      throw new Error("[DB] Unsafe DB_MODE=sqlite in production/staging. Configure PostgreSQL and remove DB_MODE=sqlite.");
    }
    console.log(`[DB] DB_MODE=sqlite, forcing SQLite mode`);
    return {
      mode: 'sqlite',
      error: 'DB_MODE=sqlite explicitly set',
      strictMode,
    };
  }

  // Auto-detect Replit PostgreSQL module env vars (PGHOST, PGPORT, PGUSER, etc.)
  if (!process.env.DATABASE_URL && process.env.PGHOST) {
    const host = process.env.PGHOST;
    const port = process.env.PGPORT || '5432';
    const user = process.env.PGUSER || 'runner';
    const password = process.env.PGPASSWORD || '';
    const database = process.env.PGDATABASE || 'postgres';
    const encoded = password ? encodeURIComponent(password) : '';
    const authPart = encoded ? `${user}:${encoded}` : user;
    process.env.DATABASE_URL = `postgresql://${authPart}@${host}:${port}/${database}`;
    console.log(`[DB] Auto-detected Replit PostgreSQL: host=${host}, db=${database}`);
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
      strictMode,
    };
  }

  if (strictMode) {
    throw new Error('[DB] DATABASE_URL is required in production/staging. Refusing to fall back to SQLite.');
  }

  // Priority 2: SQLite fallback (safe for all deployments)
  console.log('[DB] No DATABASE_URL found, using SQLite for reliability');
  return {
    mode: 'sqlite',
    error: 'No PostgreSQL configuration found, using SQLite fallback',
    strictMode,
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
