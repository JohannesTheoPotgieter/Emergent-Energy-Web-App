// DEPRECATED: Migrated to server/routes/exception-dashboard.routes.ts. Keep temporarily for backward compatibility.
import { Express } from "express";
import { registerExceptionDashboardRoutes as registerExceptionDashboardRoutesV2 } from "./routes/exception-dashboard.routes";

export function registerExceptionDashboardRoutes(app: Express) {
  registerExceptionDashboardRoutesV2(app);
}
