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
import { dbMode, dbConfig, initializeDatabase } from "./db";
import { runBackfill } from "./lib/backfill";
import { startScheduler } from "./importPipeline";

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
      role: "admin" | "member" | "quality_manager" | "viewer";
    }
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

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
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user) {
          return done(null, false, { message: "Invalid email or password" });
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Invalid email or password" });
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

// Seed demo users on startup (idempotent)
async function seedUsers() {
  const usersToSeed = [
    {
      email: process.env.DEMO_ADMIN_EMAIL || "admin@emergent.energy",
      password: process.env.DEMO_ADMIN_PASSWORD || "admin123",
      name: "COO Admin",
      role: "COO_ADMIN" as const,
    },
    {
      email: "ceo@emergent.energy",
      password: "ceo2026",
      name: "CEO Admin",
      role: "CEO_ADMIN" as const,
    },
    {
      email: "cco@emergent.energy",
      password: "emergent2026",
      name: "CCO",
      role: "CCO" as const,
    },
    {
      email: "cfo@emergent.energy",
      password: "emergent2026",
      name: "CFO",
      role: "CFO" as const,
    },
    {
      email: "pm@emergent.energy",
      password: "emergent2026",
      name: "Program Manager",
      role: "PROGRAM_MANAGER" as const,
    },
    {
      email: "pfm@emergent.energy",
      password: "emergent2026",
      name: "Program Finance Manager",
      role: "PROGRAM_FINANCE_MANAGER" as const,
    },
    {
      email: "cm@emergent.energy",
      password: "emergent2026",
      name: "Construction Manager",
      role: "CONSTRUCTION_MANAGER" as const,
    },
    {
      email: "qm@emergent.energy",
      password: "quality123",
      name: "Quality Manager",
      role: "QUALITY_MANAGER" as const,
    },
    {
      email: "epm@emergent.energy",
      password: "emergent2026",
      name: "Engineering Manager",
      role: "ENGINEERING_MANAGER" as const,
    },
    {
      email: "kam@emergent.energy",
      password: "emergent2026",
      name: "Key Accounts Manager",
      role: "KEY_ACCOUNTS_MANAGER" as const,
    },
  ];

  for (const u of usersToSeed) {
    try {
      const existing = await storage.getUserByEmail(u.email);
      if (!existing) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        const userData: any = {
          email: u.email,
          password: hashedPassword,
          name: u.name,
          role: u.role,
        };
        if (dbMode === 'sqlite') {
          userData.createdAt = new Date();
        }
        await storage.createUser(userData);
        log(`✓ ${u.role} user seeded: ${u.email}`);
      } else {
        log(`✓ ${u.role} user exists: ${u.email}`);
      }
    } catch (error) {
      log(`✗ Error seeding ${u.role} user: ` + error);
      console.error("[SEED ERROR] Full error:", error);
    }
  }
}

(async () => {
  // Initialize database FIRST before any storage operations
  await initializeDatabase();
  
  await seedUsers();
  
  const { seedQualityTemplate } = await import("./seed-quality-template");
  await seedQualityTemplate().catch(err => console.error('[Seed] Quality template error:', err));
  
  const { registerQualityRoutes } = await import("./quality-routes");
  registerQualityRoutes(app);
  
  const { registerEngineeringRoutes } = await import("./engineering-routes");
  registerEngineeringRoutes(app);

  const { registerReportRoutes } = await import("./report-routes");
  registerReportRoutes(app);

  const { registerTemplateRoutes } = await import("./template-routes");
  registerTemplateRoutes(app);

  const { registerRoleAuthRoutes, seedRoleCredentials } = await import("./role-auth-routes");
  registerRoleAuthRoutes(app);
  await seedRoleCredentials().catch(err => console.error('[Seed] Role credentials error:', err));

  const { registerLifecycleRoutes } = await import("./lifecycle-routes");
  registerLifecycleRoutes(app);

  const { registerSmartImportRoutes } = await import("./smart-import-routes");
  registerSmartImportRoutes(app);

  const { registerMeetingRoutes } = await import("./meeting-routes");
  registerMeetingRoutes(app);

  const { seedEngineeringData } = await import("./seed-engineering");
  await seedEngineeringData().catch(err => console.error('[Seed] Engineering data error:', err));

  const { registerRoleManagementRoutes, seedRolePermissions } = await import("./role-management");
  registerRoleManagementRoutes(app);
  await seedRolePermissions().catch(err => console.error('[Seed] Role permissions error:', err));
  
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
      log('SharePoint scheduled import checker started');
    },
  );
})();
