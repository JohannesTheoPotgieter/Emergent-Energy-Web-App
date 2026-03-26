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

  // B2: Sites
  try {
    const { registerSitesRoutes } = await import("../departments/sites-routes");
    registerSitesRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register sites-routes:", err);
  }

  // B3: Opportunities
  try {
    const { registerOpportunitiesRoutes } = await import("../departments/opportunities-routes");
    registerOpportunitiesRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register opportunities-routes:", err);
  }

  // B5: Budget Baselines
  try {
    const { registerBudgetBaselineRoutes } = await import("../departments/budget-baseline-routes");
    registerBudgetBaselineRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register budget-baseline-routes:", err);
  }

  // C1: Construction
  try {
    const { registerConstructionRoutes } = await import("../departments/construction-routes");
    registerConstructionRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register construction-routes:", err);
  }

  // C3: HSE
  try {
    const { registerHseRoutes } = await import("../departments/hse-routes");
    registerHseRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register hse-routes:", err);
  }

  // C4: Handover Packs
  try {
    const { registerHandoverRoutes } = await import("../departments/handover-routes");
    registerHandoverRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register handover-routes:", err);
  }

  // C5: Notification Triggers
  try {
    const { registerNotificationTriggerRoutes } = await import("../departments/notification-trigger-routes");
    registerNotificationTriggerRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register notification-trigger-routes:", err);
  }

  // D1: Pipedrive Sync
  try {
    const { registerPipedriveRoutes } = await import("../departments/pipedrive-routes");
    registerPipedriveRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register pipedrive-routes:", err);
  }
}
