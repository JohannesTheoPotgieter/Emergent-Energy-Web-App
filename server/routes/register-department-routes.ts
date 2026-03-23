import type { Express } from "express";
import { registerAdminRoutes } from "../departments/admin-routes";
import { registerExcoRoutes } from "../departments/exco-routes";

export async function registerDepartmentRoutes(app: Express) {
  registerAdminRoutes(app);
  registerExcoRoutes(app);
  const { registerPriorityStrategicRoutes } = await import("../departments/priority-strategic-routes");
  registerPriorityStrategicRoutes(app);
  const { financialIntegrationRouter } = await import("../departments/financial-integration-routes");
  app.use(financialIntegrationRouter);
  const { registerFinanceRoutes } = await import("../departments/finance-routes");
  registerFinanceRoutes(app);
  const { registerFyeRevenueTrackingRoutes } = await import("../departments/fye-revenue-tracking-routes");
  registerFyeRevenueTrackingRoutes(app);
}
