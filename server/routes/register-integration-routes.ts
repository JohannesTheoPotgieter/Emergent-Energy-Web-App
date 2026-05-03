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
  const { registerQuickBooksRoutes } = await import("../quickbooks-routes");
  registerQuickBooksRoutes(app);
  const { registerFinanceTrustRoutes } = await import("./finance-trust-routes");
  registerFinanceTrustRoutes(app);
  const { registerPendingApprovalRoutes } = await import("./pending-approvals.routes");
  registerPendingApprovalRoutes(app);
  const { registerAllApprovalHandlers } = await import("../services/pending-approvals-handlers");
  registerAllApprovalHandlers();
}
