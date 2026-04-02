import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import MemoryStore from "memorystore";
import type { Express } from "express";
import { dbMode, dbConfig, getPostgresPool } from "../db";
type LoggerFn = (message: string, source?: string) => void;

export type SessionBootstrapOptions = {
  app: Express;
  sessionSecret: string;
  startupSchemaRepairEnabled: boolean;
  startupSessionResetEnabled: boolean;
  log: LoggerFn;
};

export function configureSession(options: SessionBootstrapOptions): void {
  const { app, sessionSecret, startupSchemaRepairEnabled, startupSessionResetEnabled, log } = options;

  let sessionStore: session.Store;

  if (dbMode === "postgres" && dbConfig.connectionString) {
    const PgSession = connectPgSimple(session);
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error("[Session] PostgreSQL mode is active but the shared DB pool is not initialized.");
    }

    if (startupSchemaRepairEnabled) {
      log("Session schema auto-create enabled (startup schema repair is on)");
    } else {
      log("Session schema auto-create disabled on normal boot");
    }

    sessionStore = new PgSession({
      pool,
      createTableIfMissing: startupSchemaRepairEnabled,
    });

    if (process.env.NODE_ENV === "production" && startupSessionResetEnabled) {
      pool
        .query('DELETE FROM "session"')
        .then(() => {
          log("Cleared all sessions on deploy startup (startup session reset enabled)");
        })
        .catch(() => {});
    } else if (process.env.NODE_ENV === "production") {
      log("Startup session reset disabled; preserving existing sessions on boot");
    }
  } else {
    const MemoryStoreSession = MemoryStore(session);
    sessionStore = new MemoryStoreSession({
      checkPeriod: 24 * 60 * 60 * 1000,
    });
    log(`Using in-memory session store (dbMode=${dbMode})`);
  }

  app.set("trust proxy", 1);

  const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours
  const IDLE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

  app.use(
    session({
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset maxAge on each request (active sessions stay alive)
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax',
        maxAge: SESSION_MAX_AGE,
      },
    }),
  );

  // Idle timeout middleware: destroy session if no activity for IDLE_TIMEOUT
  app.use((req, _res, next) => {
    if (req.session) {
      const now = Date.now();
      const lastActivity = (req.session as any).lastActivity as number | undefined;
      if (lastActivity && now - lastActivity > IDLE_TIMEOUT) {
        req.session.destroy(() => {});
        return next();
      }
      (req.session as any).lastActivity = now;
    }
    next();
  });
}
