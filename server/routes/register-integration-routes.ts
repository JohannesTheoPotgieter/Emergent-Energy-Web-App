import type { Express } from "express";

export async function registerIntegrationRoutes(app: Express) {
  const { registerSyncRoutes } = await import("../sync-routes");
  registerSyncRoutes(app);
  const { registerSmartImportRoutes } = await import("../smart-import-routes");
  registerSmartImportRoutes(app);
  const { registerInvoicePatternRoutes } = await import("../invoice-pattern-routes");
  registerInvoicePatternRoutes(app);
  const { registerMsSyncRoutes } = await import("../ms-sync-routes");
  registerMsSyncRoutes(app);
}
