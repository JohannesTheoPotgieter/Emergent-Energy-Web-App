import type { Express } from "express";

export async function registerSupportRoutes(app: Express, ensureSchema: boolean) {
  const { registerSubcontractorRoutes } = await import("../subcontractor-routes");
  registerSubcontractorRoutes(app);
  const { registerMeetingRoutes } = await import("../meeting-routes");
  registerMeetingRoutes(app);
  const { registerAuditRoutes } = await import("../audit-routes");
  registerAuditRoutes(app);
  const { registerApprovalsRoutes } = await import("../approvals-routes");
  registerApprovalsRoutes(app);
  const { registerGamificationRoutes, ensureGamificationTables } = await import("../gamification-routes");
  if (ensureSchema) await ensureGamificationTables();
  registerGamificationRoutes(app);

  const { registerRoleAuthRoutes } = await import("../role-auth-routes");
  registerRoleAuthRoutes(app);
  const { registerRoleManagementRoutes } = await import("../role-management");
  registerRoleManagementRoutes(app);

  const { registerHandoverRoutes, ensureHandoverTables } = await import("../handover-routes");
  if (ensureSchema) await ensureHandoverTables();
  registerHandoverRoutes(app);

  const { registerDependencyRoutes, ensureDependencyTables } = await import("../dependency-routes");
  if (ensureSchema) await ensureDependencyTables();
  registerDependencyRoutes(app);

  const { registerRaidRoutes, ensureRaidTables } = await import("../raid-routes");
  if (ensureSchema) await ensureRaidTables();
  registerRaidRoutes(app);

  const { registerChangeControlRoutes, ensureChangeControlTables } = await import("../change-control-routes");
  if (ensureSchema) await ensureChangeControlTables();
  registerChangeControlRoutes(app);

  const { registerProcurementRoutes, ensureProcurementTables } = await import("../procurement-routes");
  if (ensureSchema) await ensureProcurementTables();
  registerProcurementRoutes(app);

  const { registerCommissioningRoutes, ensureCommissioningTables } = await import("../commissioning-routes");
  if (ensureSchema) await ensureCommissioningTables();
  registerCommissioningRoutes(app);

  const { registerInvoiceCaptureRoutes, ensureInvoiceCaptureTables } = await import("../invoice-capture-routes");
  if (ensureSchema) await ensureInvoiceCaptureTables();
  registerInvoiceCaptureRoutes(app);
}
