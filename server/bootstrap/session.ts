import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import MemoryStore from "memorystore";
import type { Express } from "express";
import { dbMode, dbConfig, getPostgresPool } from "../db";
type LoggerFn = (message: string, source?: string) => void;

// The idle-timeout middleware stamps the session with a last-activity
// timestamp. This is a local view of that extra field (the canonical
// express-session SessionData augmentation lives outside this module).
type SessionWithActivity = session.Session & { lastActivity?: number };

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

  // Prompt 0.2 follow-up: validate COOKIE_SAMESITE before feeding it to
  // express-session. An operator setting COOKIE_SAMESITE=none over HTTP
  // (e.g. Replit dev) produces cookies browsers silently reject — hard
  // to diagnose after the fact. Reject invalid values and fall back to
  // 'lax' with a loud warning so the mistake is visible at boot.
  const RAW_SAMESITE = process.env.COOKIE_SAMESITE?.trim().toLowerCase();
  const VALID_SAMESITE = new Set(["lax", "strict", "none"] as const);
  let sameSite: "lax" | "strict" | "none" = "lax";
  if (RAW_SAMESITE) {
    if (VALID_SAMESITE.has(RAW_SAMESITE as "lax" | "strict" | "none")) {
      sameSite = RAW_SAMESITE as "lax" | "strict" | "none";
    } else {
      log(
        `[Session] Ignoring invalid COOKIE_SAMESITE="${process.env.COOKIE_SAMESITE}"; falling back to 'lax'. ` +
          `Valid values: lax | strict | none.`,
        "Startup",
      );
    }
  }
  if (sameSite === "none" && process.env.NODE_ENV !== "production") {
    log(
      `[Session] COOKIE_SAMESITE=none is set in non-production. Browsers require Secure=true for SameSite=None; ` +
        `cookies will be rejected over HTTP. Use 'lax' or 'strict' for local HTTP dev.`,
      "Startup",
    );
  }

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
        sameSite,
        maxAge: SESSION_MAX_AGE,
      },
    }),
  );

  // Idle timeout middleware: destroy session if no activity for IDLE_TIMEOUT
  app.use((req, _res, next) => {
    if (req.session) {
      const now = Date.now();
      const sess = req.session as SessionWithActivity;
      const lastActivity = sess.lastActivity;
      if (lastActivity && now - lastActivity > IDLE_TIMEOUT) {
        req.session.destroy(() => {});
        return next();
      }
      sess.lastActivity = now;
    }
    next();
  });
}
