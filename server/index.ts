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
  applyRequestLogging(app, log);

  app.get("/api/environment/status", async (_req, res) => res.status(200).json(getEnvironmentStatus()));

  await initializeDatabase();

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

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  logStartupSummary(report, log);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`, "Startup");
  });
}

bootstrap();
