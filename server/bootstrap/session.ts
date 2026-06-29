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
  const isProduction = process.env.NODE_ENV === "production";

  // Replit's preview/canvas renders the app inside a cross-site iframe. A
  // SameSite=Lax session cookie is treated as third-party there and silently
  // dropped, so login "succeeds" (POST /login 200) but every following request
  // is unauthenticated — the classic bounce-back-to-login loop. In development
  // we therefore default the session cookie to SameSite=None;Secure so it
  // survives the preview iframe. Production keeps the stricter Lax default. An
  // explicit COOKIE_SAMESITE override always wins in either environment.
  if (!isProduction && !RAW_SAMESITE) {
    sameSite = "none";
  }

  // Browsers only honour SameSite=None when the cookie is also Secure. Pair
  // them automatically so the dev default above actually sticks — Replit dev is
  // served over HTTPS via the proxy (trust proxy=1), so Secure cookies are fine
  // here. Over plain HTTP localhost, set COOKIE_SAMESITE=lax to opt back out.
  const cookieSecure = isProduction || sameSite === "none";

  log(`[Session] Cookie policy resolved: sameSite=${sameSite}, secure=${cookieSecure}`, "Startup");

  app.use(
    session({
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset maxAge on each request (active sessions stay alive)
      cookie: {
        secure: cookieSecure,
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
