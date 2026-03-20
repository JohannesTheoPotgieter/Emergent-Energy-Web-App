import type { Express } from "express";
import * as c from "../controllers/v2-controller";
import { requireAuth } from "../utils/http";
import { attachProjectScope, requireProjectAccess } from "../../../middleware/project-scope-middleware";

/** Auth + scope resolution (for list/dashboard endpoints) */
const authScoped = [requireAuth, attachProjectScope] as const;

/** Auth + scope + single-project access guard (for /projects/:projectId/* endpoints) */
const authProject = [requireAuth, attachProjectScope, requireProjectAccess] as const;

export function registerApiV2Routes(app: Express) {
  app.get("/api/v2/me", requireAuth, c.me);
  app.get("/api/v2/me/permissions", requireAuth, c.mePermissions);
  app.get("/api/v2/dashboard/:role", ...authScoped, c.dashboardByRole);

  // Prompt 12: Materialized dashboard metrics
  app.get("/api/v2/dashboard-metrics", requireAuth, c.dashboardMetrics);
  app.post("/api/v2/dashboard-metrics/refresh", requireAuth, c.dashboardRefresh);

  app.get("/api/v2/projects", ...authScoped, c.listProjects);
  app.get("/api/v2/projects/:projectId", ...authProject, c.projectDetail);
  app.get("/api/v2/projects/:projectId/overview", ...authProject, c.projectOverview);
  app.get("/api/v2/projects/:projectId/lifecycle", ...authProject, c.projectLifecycle);
  app.get("/api/v2/projects/:projectId/health", ...authProject, c.projectHealth);

  app.get("/api/v2/projects/:projectId/development", ...authProject, c.projectDevelopment);
  app.post("/api/v2/projects/:projectId/development/handover", ...authProject, c.developmentHandover);

  app.get("/api/v2/projects/:projectId/engineering", ...authProject, c.projectEngineering);
  app.get("/api/v2/projects/:projectId/engineering/designs", ...authProject, c.engineeringDesigns);
  app.post("/api/v2/projects/:projectId/engineering/designs", ...authProject, c.engineeringDesigns);
  app.patch("/api/v2/projects/:projectId/engineering/designs", ...authProject, c.engineeringDesigns);

  app.get("/api/v2/projects/:projectId/quality", ...authProject, c.projectQuality);
  app.get("/api/v2/projects/:projectId/quality/checks", ...authProject, c.qualityChecks);
  app.post("/api/v2/projects/:projectId/quality/checks", ...authProject, c.qualityChecks);
  app.patch("/api/v2/projects/:projectId/quality/checks", ...authProject, c.qualityChecks);

  app.get("/api/v2/projects/:projectId/work-items", ...authProject, c.projectWorkItems);
  app.post("/api/v2/projects/:projectId/work-items", ...authProject, c.createWorkItem);
  app.patch("/api/v2/projects/:projectId/work-items/:id", ...authProject, c.patchWorkItem);

  app.get("/api/v2/projects/:projectId/milestones", ...authProject, c.projectMilestones);
  app.post("/api/v2/projects/:projectId/milestones", ...authProject, c.createMilestone);
  app.patch("/api/v2/projects/:projectId/milestones/:id", ...authProject, c.patchMilestone);

  app.get("/api/v2/projects/:projectId/procurement", ...authProject, c.projectProcurement);
  app.get("/api/v2/projects/:projectId/procurement/items", ...authProject, c.procurementItemsList);
  app.post("/api/v2/projects/:projectId/procurement/items", ...authProject, c.createProcurementItem);
  app.patch("/api/v2/projects/:projectId/procurement/items/:id", ...authProject, c.patchProcurementItem);

  app.get("/api/v2/projects/:projectId/procurement/pos", ...authProject, c.procurementPos);
  app.post("/api/v2/projects/:projectId/procurement/pos", ...authProject, c.procurementPos);
  app.patch("/api/v2/projects/:projectId/procurement/pos/:id", ...authProject, c.procurementPos);

  app.get("/api/v2/projects/:projectId/procurement/invoices", ...authProject, c.procurementInvoices);
  app.post("/api/v2/projects/:projectId/procurement/invoices", ...authProject, c.procurementInvoices);

  app.get("/api/v2/projects/:projectId/finance", ...authProject, c.projectFinance);
  app.get("/api/v2/projects/:projectId/finance/summary", ...authProject, c.financeSummary);
  app.get("/api/v2/projects/:projectId/finance/cashflow", ...authProject, c.financeCashflow);
  app.get("/api/v2/projects/:projectId/finance/cos", ...authProject, c.financeCos);
  app.get("/api/v2/projects/:projectId/finance/revenue", ...authProject, c.financeRevenue);
  app.get("/api/v2/projects/:projectId/finance/expenditure", ...authProject, c.financeExpenditure);
  app.get("/api/v2/projects/:projectId/finance/variations", ...authProject, c.financeVariations);
  app.post("/api/v2/projects/:projectId/finance/variations", ...authProject, c.financeVariations);
  app.patch("/api/v2/projects/:projectId/finance/variations", ...authProject, c.financeVariations);

  app.post("/api/v2/imports/:domain", requireAuth, c.importsByDomain);
  app.get("/api/v2/lookups/:type", requireAuth, c.lookupsByType);
  app.get("/api/v2/audit/activity", requireAuth, c.auditActivity);
}
