import type { Express } from "express";
import { registerAdminRoutes } from "../departments/admin-routes";
import { registerExcoRoutes } from "../departments/exco-routes";

export async function registerDepartmentRoutes(app: Express) {
  registerAdminRoutes(app);
  registerExcoRoutes(app);

  // Each dynamic import is wrapped individually so one module failing
  // doesn't prevent the remaining department routes from registering.
  try {
    const { registerPriorityStrategicRoutes } = await import("../departments/priority-strategic-routes");
    registerPriorityStrategicRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register priority-strategic-routes:", err);
  }

  try {
    const { financialIntegrationRouter } = await import("../departments/financial-integration-routes");
    app.use(financialIntegrationRouter);
  } catch (err) {
    console.error("[Routes] Failed to register financial-integration-routes:", err);
  }

  try {
    const { registerFinanceRoutes } = await import("../departments/finance-routes");
    registerFinanceRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register finance-routes:", err);
  }

  try {
    const { registerFyeRevenueTrackingRoutes } = await import("../departments/fye-revenue-tracking-routes");
    registerFyeRevenueTrackingRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register fye-revenue-tracking-routes:", err);
  }
}
