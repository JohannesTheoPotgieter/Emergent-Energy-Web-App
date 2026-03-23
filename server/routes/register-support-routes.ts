import type { Express } from "express";

export async function registerSupportRoutes(app: Express) {
  const { registerSubcontractorRoutes } = await import("../subcontractor-routes");
  registerSubcontractorRoutes(app);
  const { registerMeetingRoutes } = await import("../meeting-routes");
  registerMeetingRoutes(app);
  const { registerAuditRoutes } = await import("../audit-routes");
  registerAuditRoutes(app);
  const { registerApprovalsRoutes } = await import("../approvals-routes");
  registerApprovalsRoutes(app);
  const { registerGamificationRoutes } = await import("../gamification-routes");
  registerGamificationRoutes(app);

  const { registerRoleAuthRoutes } = await import("../role-auth-routes");
  registerRoleAuthRoutes(app);
  const { registerRoleManagementRoutes } = await import("../role-management");
  registerRoleManagementRoutes(app);

  const { registerHandoverRoutes } = await import("../handover-routes");
  registerHandoverRoutes(app);

  const { registerDependencyRoutes } = await import("../dependency-routes");
  registerDependencyRoutes(app);

  const { registerRaidRoutes } = await import("../raid-routes");
  registerRaidRoutes(app);

  const { registerChangeControlRoutes } = await import("../change-control-routes");
  registerChangeControlRoutes(app);

  const { registerProcurementRoutes } = await import("../procurement-routes");
  registerProcurementRoutes(app);

  const { registerCommissioningRoutes } = await import("../commissioning-routes");
  registerCommissioningRoutes(app);

  const { registerNotificationRoutes } = await import("../notification-routes");
  registerNotificationRoutes(app);

  const { registerInvoiceCaptureRoutes } = await import("../invoice-capture-routes");
  registerInvoiceCaptureRoutes(app);

  const { registerExceptionDashboardRoutes } = await import("../exception-dashboard-routes");
  registerExceptionDashboardRoutes(app);

  const { registerNotificationRoutes } = await import("../notification-routes");
  registerNotificationRoutes(app);
}
