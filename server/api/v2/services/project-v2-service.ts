import * as repo from "../repositories/project-v2-repository";
import { ApiV2Error, paginationMeta } from "../utils/http";
import { db } from "../../../db";
import { dashboardProjectMetrics, dashboardProgramMetrics } from "@shared/schema";
import { refreshAllMetrics } from "../../../services/dashboard-metrics";

export async function listProjectsService(params: { q?: string; page: number; pageSize: number; sortBy?: string; sortDir: "asc" | "desc"; scopeProjectIds?: Set<number> | null }) {
  const { rows, total } = await repo.listProjects(params);
  return { rows, meta: paginationMeta(params.page, params.pageSize, total) };
}

export async function getProjectOverviewService(projectId: number) {
  const project = await repo.getProjectById(projectId);
  if (!project) throw new ApiV2Error("NOT_FOUND", 404, "Project not found");
  const [workItems, finance, procurement] = await Promise.all([
    repo.getProjectWorkItems(projectId),
    repo.getProjectFinanceSummary(projectId),
    repo.getProjectProcurement(projectId),
  ]);
  return {
    project,
    counts: {
      workItems: workItems.length,
      procurementItems: procurement.items.length,
      invoices: procurement.invoices.length,
    },
    finance,
  };
}

export const getProjectLifecycleService = repo.getProjectLifecycle;
export const getProjectEngineeringService = repo.getProjectEngineering;
export const getProjectQualityService = repo.getProjectQuality;
export const listWorkItemsService = repo.getProjectWorkItems;
export const listMilestonesService = repo.getMilestones;
export const listProcurementItemsService = repo.listProcurementItems;
export const listPurchaseOrdersService = repo.listPurchaseOrders;
export const listInvoicesService = repo.listInvoices;
export const listFinanceVariationsService = repo.listFinanceVariations;
export const projectProcurementService = repo.getProjectProcurement;

export async function developmentHandoverService(projectId: number, userId: number, reason: string) {
  const updated = await repo.transitionProjectToConstruction(projectId, userId, reason);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Project not found");
  if ((updated as any).invalidTransition) {
    throw new ApiV2Error("VALIDATION_ERROR", 400, `Invalid lifecycle transition from ${(updated as any).currentPhase} to Construction`);
  }
  return updated;
}

export async function createWorkItemService(projectId: number, payload: any, userId: number) {
  return repo.createWorkItem(projectId, payload, userId);
}

export async function patchWorkItemService(projectId: number, id: number, payload: any) {
  const updated = await repo.patchWorkItem(projectId, id, payload);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Work item not found");
  return updated;
}

export async function createMilestoneService(projectId: number, payload: any, userId: number) {
  return repo.createWorkItem(projectId, { ...payload, isMilestone: true }, userId);
}

export async function patchMilestoneService(projectId: number, id: number, payload: any) {
  return patchWorkItemService(projectId, id, { ...payload, isMilestone: true });
}

export async function createProcurementItemService(projectId: number, payload: any) {
  return repo.createProcurementItem(projectId, payload);
}

export async function patchProcurementItemService(projectId: number, id: number, payload: any) {
  const updated = await repo.patchProcurementItem(projectId, id, payload);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Procurement item not found");
  return updated;
}

export async function createPurchaseOrderService(projectId: number, payload: any) {
  return repo.createPurchaseOrder(projectId, payload);
}

export async function patchPurchaseOrderService(projectId: number, id: number, payload: any) {
  const updated = await repo.patchPurchaseOrder(projectId, id, payload);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Purchase order not found");
  return updated;
}

export async function createInvoiceService(projectId: number, payload: any, userId: number) {
  return repo.createInvoice(projectId, payload, userId);
}

export async function financeSummaryService(projectId: number) {
  return repo.getProjectFinanceSummary(projectId);
}

export async function financeCashflowService(projectId: number) {
  return { byStatus: await repo.getFinanceCashflow(projectId) };
}

export async function financeCosService(projectId: number) {
  return { lines: await repo.getFinanceCostLines(projectId) };
}

export async function financeRevenueService(projectId: number) {
  return { lines: await repo.getFinanceRevenueLines(projectId) };
}

export async function financeExpenditureService(projectId: number) {
  const lines = await repo.getFinanceCostLines(projectId);
  return { committed: lines.filter((l) => ["APPROVED", "INVOICED", "PAID"].includes(String(l.status ?? ""))), planned: lines.filter((l) => String(l.status ?? "") === "PLANNED") };
}

export async function createFinanceVariationService(projectId: number, payload: any, userId: number) {
  return repo.createFinanceVariation(projectId, payload, userId);
}

export async function patchFinanceVariationService(projectId: number, id: number, payload: any) {
  const updated = await repo.patchFinanceVariation(projectId, id, payload);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Finance variation not found");
  return updated;
}

export const listEngineeringDesignsService = repo.listEngineeringDesigns;
export async function createEngineeringDesignService(_projectId: number, payload: any, userId: number) {
  const created = await repo.createEngineeringDesign(payload, userId);
  if (!created) throw new ApiV2Error("VALIDATION_ERROR", 400, "Engineering stage does not exist");
  return created;
}
export async function patchEngineeringDesignService(_projectId: number, id: number, payload: any, userId: number) {
  const updated = await repo.patchEngineeringDesign(id, payload, userId);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Design not found");
  return updated;
}

export const listQualityChecksService = repo.listQualityChecks;
export async function createQualityCheckService(projectId: number, payload: any) {
  const checklist = await repo.getChecklistByProject(projectId, payload.checklistId);
  if (!checklist) throw new ApiV2Error("VALIDATION_ERROR", 400, "Checklist does not belong to project");
  return repo.createQualityCheck(payload);
}
export async function patchQualityCheckService(_projectId: number, id: number, payload: any) {
  const updated = await repo.patchQualityCheck(id, payload);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Quality check not found");
  return updated;
}

export const importsByDomainService = repo.listImportsByDomain;
export const auditActivityService = repo.listAuditActivity;

export async function lookupByTypeService(type: string) {
  if (type === "users") return repo.listLookupUsers();
  if (type === "counterparties") return repo.listLookupCounterparties();
  return [];
}

export async function dashboardByRoleService(role: string, scopeProjectIds?: Set<number> | null) {
  const totals = await repo.dashboardCoreTotals(scopeProjectIds);
  if (["CFO", "ACCOUNTANT"].includes(role)) {
    return { role, cashflow: totals.pendingInvoices, cos: totals.openProcurement, overdueInvoices: totals.pendingInvoices, forecastRisk: totals.projects };
  }
  if (["PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"].includes(role)) {
    return { role, milestones: totals.openWorkItems, blockers: totals.openWorkItems, procurementBlockers: totals.openProcurement, readinessRisk: Math.max(0, totals.openWorkItems - totals.openProcurement) };
  }
  if (["ENGINEER", "ENGINEERING_MANAGER"].includes(role)) {
    return { role, designQueue: totals.openWorkItems, returnedItems: totals.openProcurement, pendingApprovals: totals.pendingInvoices };
  }
  if (role === "QUALITY_MANAGER") {
    return { role, inspections: totals.openWorkItems, warnings: totals.openProcurement, signoffQueue: totals.pendingInvoices };
  }
  if (role === "PROJECT_DEVELOPER") {
    return { role, handoverReadiness: totals.openWorkItems, outstandingDevelopmentActions: totals.openProcurement };
  }
  return { role, crossFunctionalRisk: totals.openWorkItems + totals.openProcurement, blockedProjects: totals.projects, overdueActions: totals.openWorkItems, marginRisk: totals.pendingInvoices, totals };
}

// ─── Prompt 12: Materialized dashboard metrics ─────────────────────

export async function dashboardMetricsService() {
  const [projects, program] = await Promise.all([
    db.select().from(dashboardProjectMetrics),
    db.select().from(dashboardProgramMetrics).limit(1),
  ]);

  return {
    program: program[0] ?? null,
    projects,
    lastRefreshedAt: program[0]?.lastRefreshedAt?.toISOString() ?? null,
  };
}

export async function dashboardRefreshService() {
  const result = await refreshAllMetrics();
  return { refreshed: result.refreshed, timestamp: new Date().toISOString() };
}
