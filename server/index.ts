import express from "express";
import passport from "passport";
import { createServer } from "http";
import { preloadRuntimeSecrets } from "./secrets/vault";
import { storage } from "./storage";
import { dbMode, initializeDatabase } from "./db";
import { serveStatic } from "./static";
import { getStartupModes } from "./startup-modes";
import { applySecurityAndParsingMiddleware } from "./bootstrap/security-middleware";
import { configureSession } from "./bootstrap/session";
import { configurePassportAuth } from "./bootstrap/auth";
import { jwtAuth } from "./auth-context";
import { enforceRuntimeEnvironmentGuards } from "./bootstrap/env-guard";
import { applyRequestLogging } from "./bootstrap/http-observability";
import { registerGlobalErrorHandler } from "./bootstrap/error-handling";
import { getEnvironmentStatus } from "./bootstrap/environment-status";
import { getRuntimeMutationPolicy } from "./bootstrap/runtime-mutation-policy";
import { createStartupReport, logStartupSummary } from "./bootstrap/startup-report";
import { runStartupOrchestrator } from "./bootstrap/startup-orchestrator";

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

const app = express();
const httpServer = createServer(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

async function bootstrap() {
  await preloadRuntimeSecrets();

  const startupModes = getStartupModes();
  const {
    startupMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    startupSessionResetEnabled,
  } = startupModes;

  const isLocalDevelopmentMode = process.env.LOCAL_DEV_MODE === "true";
  const isAdminMigrationMode = process.env.ADMIN_MIGRATION_MODE === "true";
  const allowStartupMutations = isLocalDevelopmentMode || isAdminMigrationMode;
  const startupSyncEnabled = process.env.STARTUP_ENABLE_PERIODIC_SYNC !== "false";

  const { sessionSecret } = enforceRuntimeEnvironmentGuards();
  await initializeDatabase();

  applySecurityAndParsingMiddleware(app);
  configureSession({
    app,
    sessionSecret,
    startupSchemaRepairEnabled,
    startupSessionResetEnabled,
    log,
  });

  configurePassportAuth(storage);
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(jwtAuth);
  applyRequestLogging(app, log);

  app.get("/api/environment/status", async (_req, res) => res.status(200).json(getEnvironmentStatus()));

  const runtimeMutationPolicy = getRuntimeMutationPolicy(startupModes);
  const report = createStartupReport(dbMode, {
    startupMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    startupSessionResetEnabled,
    startupSyncEnabled,
    runtimeMaintenanceEnabled: runtimeMutationPolicy.runtimeMaintenanceEnabled,
    runtimeMutationsActive: runtimeMutationPolicy.runtimeMutationsActive,
  });

  await runStartupOrchestrator({
    app,
    httpServer,
    runtimeMaintenanceEnabled: runtimeMutationPolicy.runtimeMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    allowStartupMutations,
    startupSyncEnabled,
    report,
    log,
  });

  registerGlobalErrorHandler(app);

  try {
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }
  } catch (err) {
    console.error("[Bootstrap] Failed to set up frontend serving:", err);
    // Serve a basic fallback so the API still works
    app.use("/{*path}", (_req, res) => {
      res.status(503).json({ error: "Frontend failed to initialize", detail: String(err) });
    });
  }

  logStartupSummary(report, log);

  const port = parseInt(process.env.PORT || "5000", 10);

  let listenRetries = 0;
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && listenRetries < 3) {
      listenRetries++;
      console.error(`[Bootstrap] Port ${port} is already in use. Retry ${listenRetries}/3 in 2s...`);
      setTimeout(() => {
        httpServer.close();
        httpServer.listen(port, "0.0.0.0");
      }, 2000);
    } else {
      console.error("[Bootstrap] Server error:", err);
    }
  });

  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`, "Startup");
  });
}

bootstrap().catch((err) => {
  console.error("[Bootstrap] Fatal error:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err);
  console.error("[Process] Stack:", err?.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection:", reason);
  if (reason instanceof Error) {
    console.error("[Process] Stack:", reason.stack);
  }
});
process.on("beforeExit", (code) => {
  console.error("[Process] beforeExit with code:", code);
});
process.on("exit", (code) => {
  console.error("[Process] exit with code:", code);
});
process.on("SIGTERM", () => {
  console.error("[Process] Received SIGTERM");
});
process.on("SIGINT", () => {
  console.error("[Process] Received SIGINT");
});
