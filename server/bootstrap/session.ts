import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import MemoryStore from "memorystore";
import pg from "pg";
import type { Express } from "express";
import { dbMode, dbConfig } from "../db";
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
    const pool = new pg.Pool({ connectionString: dbConfig.connectionString });

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
  app.use(
    session({
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );
}
