import * as repo from "../repositories/project-v2-repository";
import { ApiV2Error, paginationMeta } from "../utils/http";

export async function listProjectsService(params: { q?: string; page: number; pageSize: number; sortBy?: string; sortDir: "asc" | "desc" }) {
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

export async function developmentHandoverService(projectId: number, userId: number, reason: string) {
  const updated = await repo.transitionProjectToConstruction(projectId, userId, reason);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Project not found");
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
  return repo.createEngineeringDesign(payload, userId);
}
export async function patchEngineeringDesignService(_projectId: number, id: number, payload: any, userId: number) {
  const updated = await repo.patchEngineeringDesign(id, payload, userId);
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Design not found");
  return updated;
}

export const listQualityChecksService = repo.listQualityChecks;
export const createQualityCheckService = repo.createQualityCheck;
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

export async function dashboardByRoleService(role: string) {
  const totals = await repo.dashboardCoreTotals();
  if (["CFO", "ACCOUNTANT"].includes(role)) return { role, cashflow: totals.pendingInvoices, cosAtRisk: totals.openProcurement, forecastRiskProjects: totals.projects };
  if (["PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"].includes(role)) return { role, milestonesAtRisk: totals.openWorkItems, procurementBlockers: totals.openProcurement, siteReadinessRisk: Math.max(0, totals.openWorkItems - totals.openProcurement) };
  if (role === "ENGINEER") return { role, designQueue: totals.openWorkItems, reviewBacklog: totals.openProcurement };
  if (role === "QUALITY_MANAGER") return { role, inspectionsQueue: totals.openWorkItems, signOffBacklog: totals.pendingInvoices };
  if (role === "PROJECT_DEVELOPER") return { role, handoverReadinessRisk: totals.openWorkItems, outstandingDevelopmentActions: totals.openProcurement };
  return { role, crossFunctionalRisk: totals.openWorkItems + totals.openProcurement, blockedProjects: totals.projects, marginRiskSignals: totals.pendingInvoices, totals };
}
