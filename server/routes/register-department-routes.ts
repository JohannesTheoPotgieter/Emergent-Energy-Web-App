import type { Express } from "express";
import { registerAdminRoutes } from "../departments/admin-routes";
import { registerExcoRoutes } from "../departments/exco-routes";
import { registerRouteGroupOnce } from "./route-registration-guard";

export async function registerDepartmentRoutes(app: Express) {
  registerRouteGroupOnce({
    key: "admin-routes",
    owner: "department-admin",
    register: () => registerAdminRoutes(app),
    onSkip: (message) => console.warn(message),
  });

  registerRouteGroupOnce({
    key: "exco-routes",
    owner: "department-exco",
    register: () => registerExcoRoutes(app),
    onSkip: (message) => console.warn(message),
  });

  // Each dynamic import is wrapped individually so one module failing
  // doesn't prevent the remaining department routes from registering.

  try {
    const { registerProjectRoutes } = await import("../departments/project-routes");
    registerProjectRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register project-routes:", err);
  }

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
    registerRouteGroupOnce({
      key: "finance-routes",
      owner: "department-finance",
      register: () => registerFinanceRoutes(app),
      onSkip: (message) => console.warn(message),
    });
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

  // B7: Safety File (OHSA)
  try {
    const { registerSafetyFileRoutes } = await import("../departments/safety-file-routes");
    registerSafetyFileRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register safety-file-routes:", err);
  }

  // B8: O&M Handover tracker + dashboard
  try {
    const { registerOmHandoverRoutes } = await import("../departments/om-handover-routes");
    registerOmHandoverRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register om-handover-routes:", err);
  }

  // C1: Integration health dashboard
  try {
    const { registerIntegrationHealthRoutes } = await import("../departments/integration-health-routes");
    registerIntegrationHealthRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register integration-health-routes:", err);
  }

  // C2: Dashboard snapshot read + freshness panel
  try {
    const { registerDashboardRefreshRoutes } = await import("../departments/dashboard-refresh-routes");
    registerDashboardRefreshRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register dashboard-refresh-routes:", err);
  }

  // C4: Handover Packs / SSEG / checklist items.
  // Distinct from legacy `server/handover-routes.ts` (which serves
  // pd-pm-handover + lessons + handover-gates under `/api/pd-pm-handover/*`
  // and `/api/projects/:id/handover-gates/*`). Imported by name so the
  // two registrars don't collide.
  try {
    const { registerHandoverPacksRoutes } = await import("../departments/handover-routes");
    registerHandoverPacksRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register handover-packs-routes:", err);
  }

  // SSEG Submissions (Project Delivery)
  try {
    const { registerSsegSubmissionsRoutes } = await import("./sseg-submissions.routes");
    registerSsegSubmissionsRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register sseg-submissions.routes:", err);
  }

  // C5: Notification Triggers
  try {
    const { registerNotificationTriggerRoutes } = await import("../departments/notification-trigger-routes");
    registerNotificationTriggerRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register notification-trigger-routes:", err);
  }

  // Board Pack PDF
  try {
    const { registerBoardPackRoutes } = await import("../departments/board-pack-routes");
    registerBoardPackRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register board-pack-routes:", err);
  }

  // Drawing Register
  try {
    const { registerDrawingRegisterRoutes } = await import("../departments/drawing-register-routes");
    registerDrawingRegisterRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register drawing-register-routes:", err);
  }

  // Data Backfill
  try {
    const { registerDataBackfillRoutes } = await import("../departments/data-backfill-routes");
    registerDataBackfillRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register data-backfill-routes:", err);
  }

  // D1: Pipedrive Sync
  try {
    const { registerPipedriveRoutes } = await import("../departments/pipedrive-routes");
    registerPipedriveRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register pipedrive-routes:", err);
  }

  // Finance Analysis (Cashflow + COS analytical endpoints)
  try {
    const { registerFinanceAnalysisRoutes } = await import("./finance-analysis.routes");
    registerFinanceAnalysisRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register finance-analysis.routes:", err);
  }

  // TF-9 (audit V3) — Finance audit-prep exports (invoices, milestones, period locks).
  try {
    const { registerFinanceAuditExportRoutes } = await import("./finance-audit-export.routes");
    registerFinanceAuditExportRoutes(app);
  } catch (err) {
    console.error("[Routes] Failed to register finance-audit-export.routes:", err);
  }
}
