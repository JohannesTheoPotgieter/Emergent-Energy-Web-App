import type { Express } from "express";

export async function registerAdminSupportRoutes(app: Express) {
  const { registerAdminControlRoutes } = await import("../admin-control-routes");
  registerAdminControlRoutes(app);
  const { registerMigrationFinalizeRoutes } = await import("../migration-finalize-routes");
  registerMigrationFinalizeRoutes(app);
  const { registerAdminRecoveryRoutes } = await import("../admin-recovery-routes");
  registerAdminRecoveryRoutes(app);
  const { registerKpiTraceabilityRoutes } = await import("../kpi-traceability-routes");
  registerKpiTraceabilityRoutes(app);
}
