/**
 * Database configuration resolver
 * Handles multiple deployment scenarios with proper fallbacks
 */

export interface DbConfig {
  mode: 'postgres' | 'sqlite';
  connectionString?: string;
  error?: string;
}

export function resolveDbConfig(): DbConfig {
  // Priority 1: Use DATABASE_URL if present
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    
    // In development with Replit DB, DATABASE_URL may contain internal hostnames
    // Only validate in production deployments
    if (process.env.NODE_ENV === 'production') {
      // Check for obviously invalid hosts in production
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        return {
          mode: 'sqlite',
          error: 'Invalid DATABASE_URL detected (localhost in production)',
        };
      }
    }
    
    return {
      mode: 'postgres',
      connectionString: url,
    };
  }

  // Priority 2: Build from PG environment variables
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER && PGDATABASE) {
    // Validate host is not invalid in production
    if (process.env.NODE_ENV === 'production') {
      if (PGHOST === 'localhost' || PGHOST === '127.0.0.1') {
        return {
          mode: 'sqlite',
          error: 'Invalid PGHOST detected (localhost in production)',
        };
      }
    }
    
    const port = PGPORT || '5432';
    const password = PGPASSWORD ? `:${PGPASSWORD}` : '';
    const connectionString = `postgresql://${PGUSER}${password}@${PGHOST}:${port}/${PGDATABASE}`;
    
    return {
      mode: 'postgres',
      connectionString,
    };
  }

  // Priority 3: SQLite fallback for deployments (no network dependencies)
  return {
    mode: 'sqlite',
    error: 'No PostgreSQL configuration found, using SQLite fallback',
  };
}

export function getDbConfigStatus(): { connected: boolean; mode: string; message: string } {
  const config = resolveDbConfig();
  
  if (config.mode === 'postgres' && config.connectionString) {
    return {
      connected: true,
      mode: 'postgres',
      message: 'Connected to PostgreSQL database',
    };
  }
  
  return {
    connected: false,
    mode: config.mode,
    message: config.error || 'Database not configured',
  };
}
