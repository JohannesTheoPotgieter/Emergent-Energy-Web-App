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

  app.use((req, res, next) => {
    if (req.method === "PATCH" && req.path === "/api/tasks/reassign") {
      const origJson = res.json.bind(res);
      res.json = function(body: any) {
        if (res.statusCode >= 400) {
          const err = new Error();
          console.error("[REASSIGN-INTERCEPT] status=" + res.statusCode + " body=" + JSON.stringify(body) + " stack=" + err.stack?.split("\n").slice(1, 8).join(" | "));
        }
        return origJson(body);
      };
    }
    next();
  });

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

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  logStartupSummary(report, log);

  const port = parseInt(process.env.PORT || "5000", 10);
  const listenOptions: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform !== "win32") {
    listenOptions.reusePort = true;
  }

  httpServer.listen(listenOptions, () => {
    log(`serving on port ${port}`, "Startup");
  });
}

bootstrap();
