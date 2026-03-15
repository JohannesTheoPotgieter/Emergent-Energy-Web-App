import type { Express } from "express";
import * as c from "../controllers/v2-controller";
import { requireAuth } from "../utils/http";

export function registerApiV2Routes(app: Express) {
  app.get("/api/v2/me", requireAuth, c.me);
  app.get("/api/v2/me/permissions", requireAuth, c.mePermissions);
  app.get("/api/v2/dashboard/:role", requireAuth, c.dashboardByRole);

  app.get("/api/v2/projects", requireAuth, c.listProjects);
  app.get("/api/v2/projects/:projectId", requireAuth, c.projectDetail);
  app.get("/api/v2/projects/:projectId/overview", requireAuth, c.projectOverview);
  app.get("/api/v2/projects/:projectId/lifecycle", requireAuth, c.projectLifecycle);
  app.get("/api/v2/projects/:projectId/health", requireAuth, c.projectHealth);

  app.get("/api/v2/projects/:projectId/development", requireAuth, c.projectDevelopment);
  app.post("/api/v2/projects/:projectId/development/handover", requireAuth, c.developmentHandover);

  app.get("/api/v2/projects/:projectId/engineering", requireAuth, c.projectEngineering);
  app.get("/api/v2/projects/:projectId/engineering/designs", requireAuth, c.engineeringDesigns);
  app.post("/api/v2/projects/:projectId/engineering/designs", requireAuth, c.engineeringDesigns);
  app.patch("/api/v2/projects/:projectId/engineering/designs", requireAuth, c.engineeringDesigns);

  app.get("/api/v2/projects/:projectId/quality", requireAuth, c.projectQuality);
  app.get("/api/v2/projects/:projectId/quality/checks", requireAuth, c.qualityChecks);
  app.post("/api/v2/projects/:projectId/quality/checks", requireAuth, c.qualityChecks);
  app.patch("/api/v2/projects/:projectId/quality/checks", requireAuth, c.qualityChecks);

  app.get("/api/v2/projects/:projectId/work-items", requireAuth, c.projectWorkItems);
  app.post("/api/v2/projects/:projectId/work-items", requireAuth, c.createWorkItem);
  app.patch("/api/v2/projects/:projectId/work-items/:id", requireAuth, c.patchWorkItem);

  app.get("/api/v2/projects/:projectId/milestones", requireAuth, c.projectMilestones);
  app.post("/api/v2/projects/:projectId/milestones", requireAuth, c.createMilestone);
  app.patch("/api/v2/projects/:projectId/milestones/:id", requireAuth, c.patchMilestone);

  app.get("/api/v2/projects/:projectId/procurement", requireAuth, c.projectProcurement);
  app.get("/api/v2/projects/:projectId/procurement/items", requireAuth, c.procurementItemsList);
  app.post("/api/v2/projects/:projectId/procurement/items", requireAuth, c.createProcurementItem);
  app.patch("/api/v2/projects/:projectId/procurement/items/:id", requireAuth, c.patchProcurementItem);

  app.get("/api/v2/projects/:projectId/procurement/pos", requireAuth, c.procurementPos);
  app.post("/api/v2/projects/:projectId/procurement/pos", requireAuth, c.procurementPos);
  app.patch("/api/v2/projects/:projectId/procurement/pos/:id", requireAuth, c.procurementPos);

  app.get("/api/v2/projects/:projectId/procurement/invoices", requireAuth, c.procurementInvoices);
  app.post("/api/v2/projects/:projectId/procurement/invoices", requireAuth, c.procurementInvoices);

  app.get("/api/v2/projects/:projectId/finance", requireAuth, c.projectFinance);
  app.get("/api/v2/projects/:projectId/finance/summary", requireAuth, c.financeSummary);
  app.get("/api/v2/projects/:projectId/finance/cashflow", requireAuth, c.financeCashflow);
  app.get("/api/v2/projects/:projectId/finance/cos", requireAuth, c.financeCos);
  app.get("/api/v2/projects/:projectId/finance/revenue", requireAuth, c.financeRevenue);
  app.get("/api/v2/projects/:projectId/finance/expenditure", requireAuth, c.financeExpenditure);
  app.get("/api/v2/projects/:projectId/finance/variations", requireAuth, c.financeVariations);
  app.post("/api/v2/projects/:projectId/finance/variations", requireAuth, c.financeVariations);
  app.patch("/api/v2/projects/:projectId/finance/variations", requireAuth, c.financeVariations);

  app.post("/api/v2/imports/:domain", requireAuth, c.importsByDomain);
  app.get("/api/v2/lookups/:type", requireAuth, c.lookupsByType);
  app.get("/api/v2/audit/activity", requireAuth, c.auditActivity);
}
