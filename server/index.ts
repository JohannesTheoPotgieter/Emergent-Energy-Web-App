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
import { sql, eq } from "drizzle-orm";
import { appSettings } from "@shared/schema";
import { runBackfill } from "./lib/backfill";
import path from "path";
import { startScheduler } from "./importPipeline";
import { startMilestoneChecker } from "./milestone-notifications";
import { registerAdminRoutes } from "./departments/admin-routes";
import { registerExcoRoutes } from "./departments/exco-routes";

const app = express();
const httpServer = createServer(app);

const startupFlags = {
  ENABLE_STARTUP_MAINTENANCE: process.env.ENABLE_STARTUP_MAINTENANCE,
  ENABLE_STARTUP_SCHEMA_REPAIR: process.env.ENABLE_STARTUP_SCHEMA_REPAIR,
  ENABLE_STARTUP_SESSION_RESET: process.env.ENABLE_STARTUP_SESSION_RESET,
};

const startupMaintenanceEnabled = startupFlags.ENABLE_STARTUP_MAINTENANCE === "true";
const startupSchemaRepairEnabled =
  startupMaintenanceEnabled || startupFlags.ENABLE_STARTUP_SCHEMA_REPAIR === "true";
const startupSessionResetEnabled =
  startupMaintenanceEnabled || startupFlags.ENABLE_STARTUP_SESSION_RESET === "true";

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

app.use("/uploads", (req: any, res: any, next: any) => {
  if (req.path.includes("_private_")) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
}, express.static(path.join(process.cwd(), "uploads")));

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
    createTableIfMissing: startupSchemaRepairEnabled,
  });
  if (process.env.NODE_ENV === 'production' && startupSessionResetEnabled) {
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
    await db.execute(sql.raw(`ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS no_revenue_linked BOOLEAN DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_tasks ADD COLUMN IF NOT EXISTS has_deliverable BOOLEAN NOT NULL DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS project_eng_task_id INTEGER REFERENCES project_eng_tasks(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending'`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)`));
    await db.execute(sql.raw(`ALTER TABLE project_eng_deliverables ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`));
  } catch (e) {}

  try {
    await db.execute(sql.raw(`ALTER TABLE operational_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`));
    await db.execute(sql.raw(`ALTER TABLE mytool_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`));
    console.log("[Soft Delete] deleted_at columns ensured on operational_tasks, mytool_tasks");
  } catch (e) {}

  try {
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS primary_instruction TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS stage_code TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS definition_of_done TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS owner_role_id TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS approver_role_id TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS required_links JSONB`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS example_artifacts JSONB`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS example_notes TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS common_pitfalls JSONB`));
    await db.execute(sql.raw(`ALTER TABLE ee_info_nodes ADD COLUMN IF NOT EXISTS next_node_id TEXT`));
  } catch (e) {}

  try {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_type') THEN
          CREATE TYPE pm_action_type AS ENUM ('site_visit','generate_po','link_invoice','raise_variation','log_delay','log_risk','upload_photo','update_progress','escalate');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_status') THEN
          CREATE TYPE pm_action_status AS ENUM ('pending','approved','rejected','completed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_safety_status') THEN
          CREATE TYPE pm_safety_status AS ENUM ('clear','issue_open');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS pm_site_visits (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        visit_date DATE NOT NULL,
        notes TEXT,
        weather_conditions TEXT,
        safety_status pm_safety_status DEFAULT 'clear',
        photo_ids JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        created_by TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by TEXT,
        source TEXT DEFAULT 'on_the_go'
      );

      CREATE TABLE IF NOT EXISTS pm_on_the_go_actions (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        action_type pm_action_type NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT,
        amount DECIMAL(15,2),
        status pm_action_status DEFAULT 'pending',
        related_entity_id INTEGER,
        related_entity_type TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by TEXT,
        source TEXT DEFAULT 'on_the_go'
      );

      CREATE TABLE IF NOT EXISTS pm_compliance_tracking (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        week_start_date DATE NOT NULL,
        daily_diary_done JSONB DEFAULT '[]',
        weekly_progress_done BOOLEAN DEFAULT FALSE,
        weekly_risk_done BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, user_id, week_start_date)
      );

      CREATE TABLE IF NOT EXISTS pm_mode_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        preferred_mode TEXT DEFAULT 'full_detail',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `));
    log('PM On-The-Go tables created/verified');
  } catch (e: any) {
    log('PM On-The-Go tables error: ' + e.message);
  }

  try {
    await db.execute(sql`ALTER TABLE ms_objects ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE`);
  } catch (e: any) {
    console.error('[Migration] ms_objects dismissed column error:', e.message);
  }

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

  const { registerAdminControlRoutes } = await import("./admin-control-routes");
  registerAdminControlRoutes(app);

  const { registerApprovalsRoutes } = await import("./approvals-routes");
  registerApprovalsRoutes(app);

  const { registerGamificationRoutes, ensureGamificationTables } = await import("./gamification-routes");
  await ensureGamificationTables();
  registerGamificationRoutes(app);

  const { registerWeeklyReviewRoutes } = await import("./weekly-review-routes");
  registerWeeklyReviewRoutes(app);

  const { registerPmRoutes } = await import("./pm-routes");
  registerPmRoutes(app);

  const { registerPmOnTheGoRoutes } = await import("./pm-on-the-go-routes");
  registerPmOnTheGoRoutes(app);

  const { registerPoRoutes, ensurePoTables } = await import("./po-routes");
  await ensurePoTables();
  registerPoRoutes(app);

  const { registerDeliverableCaptureRoutes, ensureDeliverableCaptureColumns } = await import("./deliverable-capture-routes");
  await ensureDeliverableCaptureColumns();
  registerDeliverableCaptureRoutes(app);

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

  try {
    const { setFeatureFlag, getFeatureFlag } = await import("./lib/feature-flags");
    const existing = await getFeatureFlag("unified_work_v1");
    if (!existing) {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "unified_work_v1")).limit(1);
      if (!row) {
        await setFeatureFlag("unified_work_v1", true, "system");
        console.log("[Seed] Feature flag unified_work_v1 seeded (ON)");
      }
    }
  } catch (err: any) {
    console.error("[Seed] Feature flag seed error:", err.message);
  }

  const { registerEeInfoRoutes, bootImportCheck, seedStoryLifecycleData, seedStoryDemoData } = await import("./ee-info-routes");
  registerEeInfoRoutes(app);
  await bootImportCheck().catch(err => console.error('[EE-Info] Boot import error:', err));

  try {
    const storyCheck = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ee_info_nodes WHERE stage_code IS NOT NULL AND stage_code != 'DEMO' AND node_type = 'lifecycle_stage'`));
    const storyCount = parseInt(String((storyCheck as any).rows?.[0]?.cnt || "0"));
    if (storyCount === 0) {
      const count = await seedStoryLifecycleData();
      console.log(`[Story] Lifecycle stages seeded: ${count} nodes`);
    }
    const demoCheck = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ee_info_nodes WHERE stage_code = 'DEMO'`));
    const demoCount = parseInt(String((demoCheck as any).rows?.[0]?.cnt || "0"));
    if (demoCount === 0) {
      const count = await seedStoryDemoData();
      console.log(`[Story] Demo walkthrough seeded: ${count} steps`);
    }
  } catch (err) {
    console.error('[Story] Seed error (non-fatal):', err);
  }

  const { seedEeInfoUpdates } = await import("./seed-ee-info-updates");
  await seedEeInfoUpdates().catch(err => console.error('[EE-Info-Update] Seed error:', err));

  const { backfillProjectIds } = await import("./lib/backfill-project-ids");
  await backfillProjectIds().catch(err => console.error('[Backfill] Project IDs error:', err));

  try {
    const { resolveNameToUserId } = await import("./user-resolver");
    const opRows: any[] = await db.execute(sql.raw(`SELECT id, assignees, assignee_user_ids FROM operational_tasks WHERE array_length(assignees, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
    let opFixed = 0;
    for (const row of opRows) {
      const names: string[] = row.assignees || [];
      const existingIds: number[] = row.assignee_user_ids || [];
      const existingSet = new Set(existingIds);
      const newIds = [...existingIds];
      for (const name of names) {
        const resolved = await resolveNameToUserId(name);
        if (resolved && !existingSet.has(resolved)) {
          newIds.push(resolved);
          existingSet.add(resolved);
        }
      }
      if (newIds.length > existingIds.length) {
        const rowId = Number(row.id);
        const safeIds = newIds.filter(id => Number.isInteger(id));
        if (!Number.isInteger(rowId) || safeIds.length === 0) continue;
        await db.execute(sql`UPDATE operational_tasks SET assignee_user_ids = ${safeIds} WHERE id = ${rowId}`);
        opFixed++;
      }
    }
    const trRows: any[] = await db.execute(sql.raw(`SELECT id, owners, owner_user_ids FROM tr_items WHERE array_length(owners, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
    let trFixed = 0;
    for (const row of trRows) {
      const names: string[] = row.owners || [];
      const existingIds: number[] = row.owner_user_ids || [];
      const existingSet = new Set(existingIds);
      const newIds = [...existingIds];
      for (const name of names) {
        const resolved = await resolveNameToUserId(name);
        if (resolved && !existingSet.has(resolved)) {
          newIds.push(resolved);
          existingSet.add(resolved);
        }
      }
      if (newIds.length > existingIds.length) {
        const rowId = Number(row.id);
        const safeIds = newIds.filter(id => Number.isInteger(id));
        if (!Number.isInteger(rowId) || safeIds.length === 0) continue;
        await db.execute(sql`UPDATE tr_items SET owner_user_ids = ${safeIds} WHERE id = ${rowId}`);
        trFixed++;
      }
    }
    if (opFixed > 0 || trFixed > 0) console.log(`[Backfill] Synced user IDs: ${opFixed} operational tasks, ${trFixed} TR items`);
  } catch (err) {
    console.error('[Backfill] User ID sync error:', err);
  }

  try {
    const { getAssignableUsers, getAllUsers } = await import("./user-resolver");
    const assignable = await getAssignableUsers();
    const assignableIds = new Set(assignable.map(u => u.id));
    const allU = await getAllUsers();
    const nonMsIds = allU.filter(u => !assignableIds.has(u.id)).map(u => u.id);
    if (nonMsIds.length > 0 && assignable.length === 0) {
      console.log(`[MS-Filter] No MS-linked users yet — skipping assignment cleanup (${nonMsIds.length} non-MS users)`);
    } else if (nonMsIds.length > 0) {
      let opCleared = 0, trCleared = 0;
      const opRows2: any[] = await db.execute(sql.raw(`SELECT id, assignee_user_ids FROM operational_tasks WHERE array_length(assignee_user_ids, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
      for (const row of opRows2) {
        const ids: number[] = row.assignee_user_ids || [];
        const filtered = ids.filter((id: number) => assignableIds.has(id));
        if (filtered.length !== ids.length) {
          const rowId = Number(row.id);
          if (!Number.isInteger(rowId)) continue;
          await db.execute(sql`UPDATE operational_tasks SET assignee_user_ids = ${filtered.length > 0 ? filtered : sql`'{}'::integer[]`} WHERE id = ${rowId}`);
          opCleared++;
        }
      }
      const trRows2: any[] = await db.execute(sql.raw(`SELECT id, owner_user_ids FROM tr_items WHERE array_length(owner_user_ids, 1) > 0`)).then((r: any) => Array.isArray(r) ? r : r.rows || []);
      for (const row of trRows2) {
        const ids: number[] = row.owner_user_ids || [];
        const filtered = ids.filter((id: number) => assignableIds.has(id));
        if (filtered.length !== ids.length) {
          const rowId = Number(row.id);
          if (!Number.isInteger(rowId)) continue;
          await db.execute(sql`UPDATE tr_items SET owner_user_ids = ${filtered.length > 0 ? filtered : sql`'{}'::integer[]`} WHERE id = ${rowId}`);
          trCleared++;
        }
      }
      if (opCleared > 0 || trCleared > 0) console.log(`[MS-Filter] Cleared non-MS-linked assignments: ${opCleared} operational tasks, ${trCleared} TR items`);
    }
  } catch (err) {
    console.error('[MS-Filter] Assignment cleanup error:', err);
  }

  const { registerPortfolioRoutes } = await import("./portfolio-routes");
  registerPortfolioRoutes(app);

  const { registerPdRoutes } = await import("./pd-routes");
  registerPdRoutes(app);

  const { registerMsSyncRoutes } = await import("./ms-sync-routes");
  registerMsSyncRoutes(app);

  const { startPeriodicSync } = await import("./ms-sync-service");
  // Periodic Microsoft sync is normal runtime behavior and remains enabled by default.
  startPeriodicSync();

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

  // Phase 1: Canonical work_items schema migration (additive only)
  try {
    await db.execute(sql.raw(`ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_project_info_client_id ON project_info(client_id)`));

    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_workstream') THEN
          CREATE TYPE work_item_workstream AS ENUM ('PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_source') THEN
          CREATE TYPE work_item_source AS ENUM ('SMART_IMPORT', 'UI', 'INTEGRATION', 'SYSTEM');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_assignment_role') THEN
          CREATE TYPE work_item_assignment_role AS ENUM ('OWNER', 'ASSIGNEE', 'REVIEWER', 'VIEWER');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_dep_type') THEN
          CREATE TYPE work_item_dep_type AS ENUM ('FS', 'SS', 'FF', 'SF');
        END IF;
      END $$;
    `));

    await db.execute(sql.raw(`
      DO $$ BEGIN
        ALTER TYPE work_item_assignment_role ADD VALUE IF NOT EXISTS 'VIEWER';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_items (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id),
        project_id INTEGER REFERENCES project_info(id),
        workstream work_item_workstream NOT NULL,
        type TEXT,
        source work_item_source NOT NULL DEFAULT 'UI',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'Not Started',
        priority TEXT,
        start_date TEXT,
        end_date TEXT,
        duration INTEGER,
        percent_complete REAL DEFAULT 0,
        wbs_code TEXT,
        outline_number TEXT,
        parent_id INTEGER,
        owner_user_id INTEGER REFERENCES users(id),
        is_shared BOOLEAN NOT NULL DEFAULT FALSE,
        external_ref TEXT UNIQUE,
        legacy_table TEXT,
        legacy_id INTEGER,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id);
      CREATE INDEX IF NOT EXISTS idx_work_items_workstream ON work_items(workstream);
      CREATE INDEX IF NOT EXISTS idx_work_items_owner ON work_items(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_work_items_external_ref ON work_items(external_ref);
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_assignments (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        role work_item_assignment_role NOT NULL DEFAULT 'ASSIGNEE',
        allocation_pct REAL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_work_item_assignments_work_item ON work_item_assignments(work_item_id);
      CREATE INDEX IF NOT EXISTS idx_work_item_assignments_user ON work_item_assignments(user_id);
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_dependencies (
        id SERIAL PRIMARY KEY,
        predecessor_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        successor_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        dep_type work_item_dep_type NOT NULL DEFAULT 'FS',
        lag_days INTEGER DEFAULT 0
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_comments (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_attachments (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS work_item_status_history (
        id SERIAL PRIMARY KEY,
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        old_status TEXT,
        new_status TEXT NOT NULL,
        changed_by INTEGER REFERENCES users(id),
        changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reason TEXT
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_client_history (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id),
        old_client_id INTEGER REFERENCES clients(id),
        new_client_id INTEGER REFERENCES clients(id),
        moved_by_user_id INTEGER NOT NULL REFERENCES users(id),
        moved_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reason TEXT
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS import_field_mappings (
        id SERIAL PRIMARY KEY,
        import_profile TEXT NOT NULL,
        sheet_name TEXT,
        excel_column_header TEXT NOT NULL,
        target_table TEXT NOT NULL,
        target_field TEXT NOT NULL,
        transform TEXT,
        required BOOLEAN NOT NULL DEFAULT FALSE,
        default_value TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS migration_backups (
        id SERIAL PRIMARY KEY,
        backup_id TEXT NOT NULL,
        backup_type TEXT NOT NULL DEFAULT 'manual',
        description TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_by_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS migration_cleanup_log (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        archived_name TEXT,
        row_count INTEGER,
        performed_by_user_id INTEGER REFERENCES users(id),
        performed_by_name TEXT,
        backup_id TEXT,
        reversible BOOLEAN NOT NULL DEFAULT TRUE,
        performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata TEXT
      );
    `));

    console.log('[Migration] Phase 1 canonical tables created successfully');
  } catch (err: any) {
    console.error('[Migration] Phase 1 error:', err.message);
  }

  try {
    await db.execute(sql.raw(`
      ALTER TABLE ms_accounts ADD COLUMN IF NOT EXISTS sso_access_token TEXT;
      ALTER TABLE ms_accounts ADD COLUMN IF NOT EXISTS sso_token_expires_at TIMESTAMP;
    `));
  } catch (err: any) {
    console.error('[Migration] ms_accounts SSO token columns error:', err.message);
  }

  try {
    await db.execute(sql.raw(`
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS expected_pct_complete REAL;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS indent_level INTEGER DEFAULT 0;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT FALSE;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS phase TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS owner_name TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_row INTEGER;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_sheet TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS baseline_start TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS baseline_end TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS baseline_duration INTEGER;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS task_mode TEXT DEFAULT 'auto';
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS actual_start TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS actual_end TEXT;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS actual_duration INTEGER;
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
    `));

    await db.execute(sql.raw(`
      UPDATE work_items wi
      SET actual_start = COALESCE(wi.actual_start, npt.actual_start_date),
          actual_end = COALESCE(wi.actual_end, npt.actual_end_date),
          actual_duration = COALESCE(wi.actual_duration, npt.actual_duration_days)
      FROM normalized_plan_tasks npt
      WHERE wi.legacy_table = 'normalized_plan_tasks'
        AND wi.legacy_id = npt.id
        AND (wi.actual_start IS NULL OR wi.actual_end IS NULL)
        AND (npt.actual_start_date IS NOT NULL OR npt.actual_end_date IS NOT NULL)
    `));

    await db.execute(sql.raw(`
      UPDATE work_items wi
      SET actual_start = COALESCE(wi.actual_start, npt.actual_start_date),
          actual_end = COALESCE(wi.actual_end, npt.actual_end_date),
          actual_duration = COALESCE(wi.actual_duration, npt.actual_duration_days)
      FROM normalized_plan_tasks npt
      WHERE wi.source = 'SMART_IMPORT'
        AND (wi.actual_start IS NULL OR wi.actual_end IS NULL)
        AND wi.project_id = npt.project_id
        AND wi.title = npt.task_name
        AND wi.deleted_at IS NULL
        AND (npt.actual_start_date IS NOT NULL OR npt.actual_end_date IS NOT NULL)
    `));
  } catch (err: any) {
    console.error('[Migration] work_items canonical columns error:', err.message);
  }

  try {
    const { backfillWorkItems } = await import("./work-items-backfill");
    await backfillWorkItems();
  } catch (err: any) {
    console.error("[Backfill] work_items backfill failed:", err.message);
  }

  try {
    const { getAllUsers, resolveNameToUserId } = await import("./user-resolver");
    await getAllUsers();

    async function resolveNamesForBackfill(names: string[]): Promise<number[]> {
      const ids: number[] = [];
      const seen = new Set<number>();
      for (const n of names) {
        if (!n || !n.trim()) continue;
        const uid = await resolveNameToUserId(n);
        if (uid && !seen.has(uid)) {
          ids.push(uid);
          seen.add(uid);
        }
      }
      return ids;
    }

    let otUpdated = 0;
    let otOffset = 0;
    while (true) {
      const otRows = await db.execute(sql.raw(`
        SELECT id, assignees FROM operational_tasks
        WHERE assignees IS NOT NULL AND array_length(assignees, 1) > 0
          AND (assignee_user_ids IS NULL OR array_length(assignee_user_ids, 1) = 0 OR array_length(assignee_user_ids, 1) IS NULL)
        ORDER BY id LIMIT 200 OFFSET ${otOffset}
      `));
      const rows = (otRows as any).rows || [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const ids = await resolveNamesForBackfill(row.assignees || []);
        if (ids.length > 0) {
          const idsStr = `{${ids.join(",")}}`;
          await db.execute(sql.raw(`UPDATE operational_tasks SET assignee_user_ids = '${idsStr}'::integer[] WHERE id = ${row.id}`));
          otUpdated++;
        }
      }
      if (rows.length < 200) break;
      otOffset += 200;
    }

    let trUpdated = 0;
    let trOffset = 0;
    while (true) {
      const trRows = await db.execute(sql.raw(`
        SELECT id, owners FROM tr_items
        WHERE owners IS NOT NULL AND array_length(owners, 1) > 0
          AND (owner_user_ids IS NULL OR array_length(owner_user_ids, 1) = 0 OR array_length(owner_user_ids, 1) IS NULL)
        ORDER BY id LIMIT 200 OFFSET ${trOffset}
      `));
      const rows = (trRows as any).rows || [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const ids = await resolveNamesForBackfill(row.owners || []);
        if (ids.length > 0) {
          const idsStr = `{${ids.join(",")}}`;
          await db.execute(sql.raw(`UPDATE tr_items SET owner_user_ids = '${idsStr}'::integer[] WHERE id = ${row.id}`));
          trUpdated++;
        }
      }
      if (rows.length < 200) break;
      trOffset += 200;
    }

    if (otUpdated > 0 || trUpdated > 0) {
      log(`[Backfill] assignee_user_ids: ${otUpdated} operational_tasks, ${trUpdated} tr_items updated`);
    }
  } catch (err: any) {
    console.error("[Backfill] assignee_user_ids sync error:", err.message);
  }

  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS user_project_folders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        project_name TEXT NOT NULL,
        folder_name TEXT NOT NULL,
        folder_path TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, project_name)
      );
    `));
  } catch (err: any) {
    console.error('[Migration] user_project_folders error:', err.message);
  }

  try {
    await db.execute(sql.raw(`ALTER TABLE smart_import_runs ADD COLUMN IF NOT EXISTS records_attempted INTEGER`));
    await db.execute(sql.raw(`ALTER TABLE smart_import_runs ADD COLUMN IF NOT EXISTS records_succeeded INTEGER`));
    await db.execute(sql.raw(`ALTER TABLE smart_import_runs ADD COLUMN IF NOT EXISTS records_failed INTEGER`));
    await db.execute(sql.raw(`ALTER TABLE smart_import_runs ADD COLUMN IF NOT EXISTS import_type TEXT`));
  } catch (err: any) {
    console.error('[Migration] smart_import_runs columns error:', err.message);
  }

  const { registerHandoverRoutes, ensureHandoverTables } = await import("./handover-routes");
  await ensureHandoverTables();
  registerHandoverRoutes(app);

  const { registerDependencyRoutes, ensureDependencyTables } = await import("./dependency-routes");
  await ensureDependencyTables();
  registerDependencyRoutes(app);

  const { registerRaidRoutes, ensureRaidTables } = await import("./raid-routes");
  await ensureRaidTables();
  registerRaidRoutes(app);

  const { registerChangeControlRoutes, ensureChangeControlTables } = await import("./change-control-routes");
  await ensureChangeControlTables();
  registerChangeControlRoutes(app);

  const { registerProcurementRoutes, ensureProcurementTables } = await import("./procurement-routes");
  await ensureProcurementTables();
  registerProcurementRoutes(app);

  const { registerCommissioningRoutes, ensureCommissioningTables } = await import("./commissioning-routes");
  await ensureCommissioningTables();
  registerCommissioningRoutes(app);

  await db.execute(sql.raw(`
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS related_entity_id INTEGER;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS assigned_approver INTEGER REFERENCES users(id);
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES project_info(id);
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approval_category TEXT;
  `));
  console.log("[Approvals] Enhanced columns ensured");

  const { registerInvoiceCaptureRoutes, ensureInvoiceCaptureTables } = await import("./invoice-capture-routes");
  await ensureInvoiceCaptureTables();
  registerInvoiceCaptureRoutes(app);

  registerAdminRoutes(app);
  registerExcoRoutes(app);
  const { financialIntegrationRouter } = await import("./departments/financial-integration-routes");
  app.use(financialIntegrationRouter);
  const { registerFinanceRoutes } = await import("./departments/finance-routes");
  registerFinanceRoutes(app);
  const { registerMigrationFinalizeRoutes } = await import("./migration-finalize-routes");
  registerMigrationFinalizeRoutes(app);

  const { registerKpiTraceabilityRoutes } = await import("./kpi-traceability-routes");
  registerKpiTraceabilityRoutes(app);

  const { registerAdminRecoveryRoutes } = await import("./admin-recovery-routes");
  registerAdminRecoveryRoutes(app);

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
