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
  const { registerTemplateGovernanceRoutes } = await import("./template-governance-routes");
  registerTemplateGovernanceRoutes(app);
  // Task #101 — role templates (curated permission "starter packs").
  const { registerRoleTemplateRoutes } = await import("./admin-role-templates.routes");
  registerRoleTemplateRoutes(app);
}
