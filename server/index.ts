import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import connectPgSimple from "connect-pg-simple";
import MemoryStore from "memorystore";
import pg from "pg";
import { dbMode, dbConfig, initializeDatabase, db } from "./db";
import { sql } from "drizzle-orm";
import { runBackfill } from "./lib/backfill";
import { startScheduler } from "./importPipeline";
import { startMilestoneChecker } from "./milestone-notifications";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    passport: { user: number };
  }
}

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      name: string;
      role: string;
    }
  }
}

app.use(
  express.json({
    limit: '100mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((err: any, _req: any, res: any, next: any) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: "Invalid request format",
      message: "The request data could not be read. Please check the data and try again."
    });
  }
  next(err);
});

// Trust proxy for Replit deployment (needed for secure cookies)
app.set('trust proxy', 1);

// Session configuration - use appropriate store based on DB mode
let sessionStore: any;

if (dbMode === 'postgres' && dbConfig.connectionString) {
  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({ connectionString: dbConfig.connectionString });
  sessionStore = new PgSession({
    pool,
    createTableIfMissing: true,
  });
  if (process.env.NODE_ENV === 'production') {
    pool.query('DELETE FROM "session"').then(() => {
      log('Cleared all sessions on deploy startup');
    }).catch(() => {});
  }
  log('Using PostgreSQL session store');
} else {
  // Fallback to memory store for SQLite mode
  const MemoryStoreSession = MemoryStore(session);
  sessionStore = new MemoryStoreSession({
    checkPeriod: 86400000, // prune expired entries every 24h
  });
  log('Using in-memory session store (SQLite fallback mode)');
}

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "emergent-energy-secret-key-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(
  new LocalStrategy(
    { usernameField: "username" },
    async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username.toLowerCase());
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, { 
          id: user.id, 
          email: user.email, 
          name: user.name, 
          role: user.role 
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await storage.getUser(id);
    if (!user) {
      return done(null, false);
    }
    done(null, { 
      id: user.id, 
      email: user.email, 
      name: user.name, 
      role: user.role 
    });
  } catch (err) {
    done(err);
  }
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function seedUsers() {
  const usersToSeed = [
    { username: "dayne", name: "Dayne", role: "CEO_ADMIN" as const, password: "2020" },
    { username: "natasha", name: "Natasha", role: "CCO" as const, password: "2021" },
    { username: "tasneema", name: "Tasneema", role: "CFO" as const, password: "2022" },
    { username: "johannes", name: "Johannes", role: "COO_ADMIN" as const, password: "2023" },
    { username: "roedolph", name: "Roedolph", role: "PROGRAM_MANAGER" as const, password: "2024" },
    { username: "dean", name: "Dean", role: "QUALITY_MANAGER" as const, password: "2025" },
    { username: "peet", name: "Peet", role: "CONSTRUCTION_MANAGER" as const, password: "2026" },
    { username: "mizelda", name: "Mizelda", role: "PROGRAM_FINANCE_MANAGER" as const, password: "2027" },
    { username: "thami", name: "Thami", role: "ACCOUNTANT" as const, password: "2028" },
    { username: "paul", name: "Paul", role: "ENGINEER" as const, password: "2029" },
    { username: "tanaka", name: "Tanaka", role: "ENGINEER" as const, password: "2030" },
    { username: "johan", name: "Johan", role: "ENGINEER" as const, password: "2031" },
    { username: "mary", name: "Mary", role: "ENGINEER" as const, password: "2032" },
    { username: "gerhard", name: "Gerhard", role: "ENGINEER" as const, password: "2033" },
    { username: "brandon", name: "Brandon", role: "ENGINEER" as const, password: "2034" },
    { username: "eon", name: "Eon Van Rensburg", role: "PROJECT_MANAGER_SITE" as const, password: "2035" },
    { username: "shaun", name: "Shaun", role: "PROJECT_MANAGER_SITE" as const, password: "2036" },
    { username: "jt", name: "JT Moorosi", role: "PROJECT_MANAGER_SITE" as const, password: "2037" },
    { username: "lloyd", name: "Lloyd Brown", role: "PROJECT_MANAGER_SITE" as const, password: "2038" },
    { username: "justin", name: "Justin Franke", role: "PROJECT_MANAGER_SITE" as const, password: "2039" },
    { username: "cole", name: "Cole Bisset", role: "PROJECT_DEVELOPER" as const, password: "2040" },
    { username: "gordon", name: "Gordon Upton", role: "PROJECT_DEVELOPER" as const, password: "2041" },
    { username: "megan", name: "Megan Moore", role: "PROJECT_DEVELOPER" as const, password: "2042" },
    { username: "kirsten", name: "Kirsten Marwick", role: "PROJECT_DEVELOPER" as const, password: "2043" },
  ];

  for (const u of usersToSeed) {
    try {
      const existing = await storage.getUserByUsername(u.username);
      if (!existing) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        await storage.createUser({
          username: u.username,
          email: `${u.username}@emergent.energy`,
          password: hashedPassword,
          name: u.name,
          role: u.role,
        });
        log(`✓ User seeded: ${u.username} (${u.role})`);
      } else {
        log(`✓ User exists: ${u.username} (${u.role})`);
      }
    } catch (error) {
      log(`✗ Error seeding user ${u.username}: ` + error);
      console.error("[SEED ERROR] Full error:", error);
    }
  }
}

async function backfillPmUserIds() {
  try {
    await db.execute(sql.raw(`ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_user_id INTEGER REFERENCES users(id)`));

    const mappings: [string, string[]][] = [
      ["eon", ["Eon Van Rensburg", "Eon Van Rensberg"]],
      ["jt", ["JT Moorosi", "JT"]],
      ["lloyd", ["Lloyd Brown", "Lloyd"]],
      ["justin", ["Justin Franke"]],
    ];

    let totalUpdated = 0;
    for (const [username, pmNames] of mappings) {
      const pmList = pmNames.map(n => `'${n.replace(/'/g, "''")}'`).join(",");
      const result = await db.execute(sql.raw(
        `UPDATE project_info SET pm_user_id = (SELECT id FROM users WHERE username = '${username}') WHERE pm = ANY(ARRAY[${pmList}])`
      ));
      const count = (result as any).rowCount || 0;
      totalUpdated += count;
    }
    log(`Backfill pm_user_id: ${totalUpdated} rows updated`);

    const unassignResult = await db.execute(sql.raw(`
      UPDATE operational_tasks ot
      SET owner_user_id = NULL
      FROM project_info pi
      WHERE ot.project_name = pi.project_name
        AND pi.phase IN ('Compliance Handover', 'Commercial Close Out')
        AND ot.owner_user_id IS NOT NULL
    `));
    const unassignCount = (unassignResult as any).rowCount || 0;
    log(`Unassign tasks for Compliance Handover / Commercial Close Out: ${unassignCount} tasks cleared`);

    const taskResult = await db.execute(sql.raw(`
      UPDATE operational_tasks ot
      SET owner_user_id = pi.pm_user_id
      FROM project_info pi
      WHERE ot.project_name = pi.project_name
        AND pi.pm_user_id IS NOT NULL
        AND pi.phase NOT IN ('Compliance Handover', 'Commercial Close Out')
        AND (ot.owner_user_id IS NULL OR ot.owner_user_id != pi.pm_user_id)
    `));
    const taskCount = (taskResult as any).rowCount || 0;
    log(`Backfill task owner_user_id to PM: ${taskCount} tasks updated`);
  } catch (error) {
    log(`Backfill pm_user_id error: ${error}`);
  }
}

(async () => {
  // Initialize database FIRST before any storage operations
  await initializeDatabase();
  
  await seedUsers();
  await backfillPmUserIds();

  try {
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS sharepoint_folder_path TEXT`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS has_deliverable BOOLEAN NOT NULL DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS project_eng_task_id INTEGER REFERENCES project_eng_tasks(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending'`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`));
  } catch (e) {}

  
  const { seedQualityTemplate } = await import("./seed-quality-template");
  await seedQualityTemplate().catch(err => console.error('[Seed] Quality template error:', err));

  const { seedEngStageTemplates } = await import("./seed-eng-templates");
  await seedEngStageTemplates().catch(err => console.error('[Seed] Eng stage templates error:', err));
  
  const { registerQualityRoutes } = await import("./quality-routes");
  registerQualityRoutes(app);
  
  const { registerEngineeringRoutes } = await import("./engineering-routes");
  registerEngineeringRoutes(app);

  const { registerEngStageRoutes } = await import("./eng-stage-routes");
  registerEngStageRoutes(app);

  const { registerReportRoutes } = await import("./report-routes");
  registerReportRoutes(app);

  const { registerTemplateRoutes } = await import("./template-routes");
  registerTemplateRoutes(app);

  const { registerRoleAuthRoutes, seedRoleCredentials } = await import("./role-auth-routes");
  registerRoleAuthRoutes(app);
  await seedRoleCredentials().catch(err => console.error('[Seed] Role credentials error:', err));

  const { registerLifecycleRoutes } = await import("./lifecycle-routes");
  registerLifecycleRoutes(app);

  const { registerSyncRoutes } = await import("./sync-routes");
  registerSyncRoutes(app);

  const { registerSmartImportRoutes } = await import("./smart-import-routes");
  registerSmartImportRoutes(app);

  const { registerInvoicePatternRoutes } = await import("./invoice-pattern-routes");
  registerInvoicePatternRoutes(app);

  const { registerSubcontractorRoutes } = await import("./subcontractor-routes");
  registerSubcontractorRoutes(app);

  const { registerMeetingRoutes } = await import("./meeting-routes");
  registerMeetingRoutes(app);

  const { registerAuditRoutes } = await import("./audit-routes");
  registerAuditRoutes(app);

  const { registerApprovalsRoutes } = await import("./approvals-routes");
  registerApprovalsRoutes(app);

  const { registerGamificationRoutes, ensureGamificationTables } = await import("./gamification-routes");
  await ensureGamificationTables();
  registerGamificationRoutes(app);

  const { registerWeeklyReviewRoutes } = await import("./weekly-review-routes");
  registerWeeklyReviewRoutes(app);

  const { registerPmRoutes } = await import("./pm-routes");
  registerPmRoutes(app);

  const { registerTrRegisterRoutes, seedTrRegisterData } = await import("./tr-register-routes");
  registerTrRegisterRoutes(app);
  await seedTrRegisterData().catch(err => console.error('[Seed] TR Register error:', err));

  const { seedEngineeringData } = await import("./seed-engineering");
  await seedEngineeringData().catch(err => console.error('[Seed] Engineering data error:', err));

  const { seedIntakeTaskTemplates } = await import("./seed-intake-templates");
  await seedIntakeTaskTemplates().catch(err => console.error('[Seed] Intake templates error:', err));

  const { registerRoleManagementRoutes, seedRolePermissions } = await import("./role-management");
  registerRoleManagementRoutes(app);
  await seedRolePermissions().catch(err => console.error('[Seed] Role permissions error:', err));

  const { runDataSeedMigration } = await import("./seed-data-migration");
  await runDataSeedMigration().catch(err => console.error('[DataSeed] Migration error:', err));

  const { registerEeInfoRoutes, bootImportCheck } = await import("./ee-info-routes");
  registerEeInfoRoutes(app);
  await bootImportCheck().catch(err => console.error('[EE-Info] Boot import error:', err));

  const { seedEeInfoUpdates } = await import("./seed-ee-info-updates");
  await seedEeInfoUpdates().catch(err => console.error('[EE-Info-Update] Seed error:', err));

  const { backfillProjectIds } = await import("./lib/backfill-project-ids");
  await backfillProjectIds().catch(err => console.error('[Backfill] Project IDs error:', err));

  const { registerPortfolioRoutes } = await import("./portfolio-routes");
  registerPortfolioRoutes(app);

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      client_name TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      description TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portfolio_rollout_plans (
      id SERIAL PRIMARY KEY,
      portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portfolio_rollout_phases (
      id SERIAL PRIMARY KEY,
      rollout_plan_id INTEGER NOT NULL REFERENCES portfolio_rollout_plans(id) ON DELETE CASCADE,
      phase_name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      target_kwp DECIMAL(12,2),
      target_revenue DECIMAL(15,2),
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS project_portfolio_assignments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id) UNIQUE,
      portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id),
      assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      moved_by INTEGER REFERENCES users(id),
      moved_at TIMESTAMP
    );
  `)).catch(err => console.error('[Portfolio] Table creation error:', err));

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      runBackfill().catch(err => console.error('[Backfill] startup error:', err));
      startScheduler();
      startMilestoneChecker();
      log('SharePoint scheduled import checker started');
    },
  );
})();
