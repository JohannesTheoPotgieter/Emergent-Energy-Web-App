import type { Request, Response } from "express";
import { assertPermission, permissionsForRole } from "../policies/access-policy";
import { recordAudit } from "../services/audit-service";
import * as service from "../services/project-v2-service";
import { ApiV2Error, asyncHandler, created, ok, paginationQuerySchema, validate } from "../utils/http";
import { getProjectScope } from "../../../middleware/project-scope-middleware";
import { scopeProjectIds } from "../../../services/project-access-service";
import { computeProjectPermissions } from "../middleware/permission-helper";
import {
  engineeringDesignCreateSchema,
  engineeringDesignPatchSchema,
  financeVariationCreateSchema,
  financeVariationPatchSchema,
  idParamSchema,
  invoiceCreateSchema,
  milestoneCreateSchema,
  milestonePatchSchema,
  procurementItemCreateSchema,
  procurementItemPatchSchema,
  procurementPoCreateSchema,
  procurementPoPatchSchema,
  projectIdParamSchema,
  qualityCheckCreateSchema,
  qualityCheckPatchSchema,
  workItemCreateSchema,
  workItemPatchSchema,
} from "../validators/project-v2-validators";

const actor = (req: Request) => ({ actorRole: (req.user as any).role, userId: (req.user as any).id, userName: (req.user as any).name });


const assertBodyProjectContext = (routeProjectId: number, payload: { projectId?: number }) => {
  if (payload.projectId != null && payload.projectId !== routeProjectId) {
    throw new ApiV2Error("VALIDATION_ERROR", 400, "projectId in payload must match route projectId");
  }
};

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as any;
  ok(res, { id: user.id, email: user.email, name: user.name, role: user.role });
});

export const mePermissions = asyncHandler(async (req: Request, res: Response) => {
  const role = (req.user as any).role;
  ok(res, { role, permissions: permissionsForRole(role) });
});

export const dashboardByRole = asyncHandler(async (req: Request, res: Response) => {
  const role = String(req.params.role || (req.user as any).role);
  const scope = getProjectScope(req);
  ok(res, await service.dashboardByRoleService(role, scopeProjectIds(scope)));
});

export const listProjects = asyncHandler(async (req, res) => {
  const query = validate(paginationQuerySchema, req.query, "Invalid pagination query");
  const scope = getProjectScope(req);
  const response = await service.listProjectsService({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 25, sortDir: query.sortDir ?? "asc", scopeProjectIds: scopeProjectIds(scope) });
  ok(res, response.rows, response.meta);
});

export const projectOverview = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectOverviewService(projectId));
});

export const projectLifecycle = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectLifecycleService(projectId));
});

export const projectHealth = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const finance = await service.getProjectOverviewService(projectId);
  ok(res, {
    ragStatus: finance.project.ragStatus,
    escalationLevel: finance.project.escalationLevel,
    margin: Number(finance.finance.revenue.actual || 0) - Number(finance.finance.cost.actual || 0),
  });
});

export const projectDevelopment = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const detail = await service.getProjectOverviewService(projectId);
  ok(res, { pd: detail.project.pd, pdUserId: detail.project.pdUserId, phase: detail.project.phase, pdHandoverDate: detail.project.pdHandoverDate, signedStatus: detail.project.signedStatus });
});

export const developmentHandover = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  assertPermission((req.user as any).role, "development.write");
  const updated = await service.developmentHandoverService(projectId, (req.user as any).id, String(req.body?.reason || "handover"));
  await recordAudit({ ...actor(req), entityType: "project", entityId: String(projectId), action: "DEVELOPMENT_HANDOVER", requestPath: req.path, requestMethod: req.method, changesJson: { phase: updated.phase } });
  created(res, { projectId, transitionedTo: updated.phase });
});

export const engineeringDesigns = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    assertPermission((req.user as any).role, "engineering.write");
    const payload = validate(engineeringDesignCreateSchema, req.body, "Invalid engineering design payload");
    assertBodyProjectContext(projectId, payload);
    const row = await service.createEngineeringDesignService(projectId, payload, (req.user as any).id);
    await recordAudit({ ...actor(req), entityType: "engineering_design", entityId: String(row.id), action: "CREATE" });
    return created(res, row);
  }
  if (req.method === "PATCH") {
    assertPermission((req.user as any).role, "engineering.write");
    const payload = validate(engineeringDesignPatchSchema, req.body, "Invalid engineering design patch payload");
    const row = await service.patchEngineeringDesignService(projectId, payload.id, payload, (req.user as any).id);
    await recordAudit({ ...actor(req), entityType: "engineering_design", entityId: String(row.id), action: "PATCH" });
    return ok(res, row);
  }
  ok(res, await service.listEngineeringDesignsService(projectId));
});

export const qualityChecks = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    assertPermission((req.user as any).role, "quality.write");
    const payload = validate(qualityCheckCreateSchema, req.body, "Invalid quality check payload");
    assertBodyProjectContext(projectId, payload);
    const row = await service.createQualityCheckService(projectId, payload);
    await recordAudit({ ...actor(req), entityType: "quality_check", entityId: String(row.id), action: "CREATE" });
    return created(res, row);
  }
  if (req.method === "PATCH") {
    assertPermission((req.user as any).role, "quality.write");
    const payload = validate(qualityCheckPatchSchema, req.body, "Invalid quality check patch payload");
    const row = await service.patchQualityCheckService(projectId, payload.id, payload);
    await recordAudit({ ...actor(req), entityType: "quality_check", entityId: String(row.id), action: "PATCH" });
    return ok(res, row);
  }
  ok(res, await service.listQualityChecksService(projectId));
});

export const projectWorkItems = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.listWorkItemsService(projectId));
});

export const createWorkItem = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "work_items.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const payload = validate(workItemCreateSchema, req.body, "Invalid work item payload");
  assertBodyProjectContext(projectId, payload);
  const createdRow = await service.createWorkItemService(projectId, payload, (req.user as any).id);
  await recordAudit({ ...actor(req), entityType: "work_item", entityId: String(createdRow.id), action: "CREATE" });
  created(res, createdRow);
});

export const patchWorkItem = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "work_items.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const { id } = validate(idParamSchema, req.params, "Invalid id");
  const payload = validate(workItemPatchSchema, req.body, "Invalid work item patch payload");
  const row = await service.patchWorkItemService(projectId, id, payload);
  await recordAudit({ ...actor(req), entityType: "work_item", entityId: String(row.id), action: "PATCH" });
  ok(res, row);
});

export const projectMilestones = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.listMilestonesService(projectId));
});

export const createMilestone = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "milestones.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const payload = validate(milestoneCreateSchema, req.body, "Invalid milestone payload");
  assertBodyProjectContext(projectId, payload);
  const row = await service.createMilestoneService(projectId, payload, (req.user as any).id);
  await recordAudit({ ...actor(req), entityType: "milestone", entityId: String(row.id), action: "CREATE" });
  created(res, row);
});

export const patchMilestone = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "milestones.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const { id } = validate(idParamSchema, req.params, "Invalid id");
  const payload = validate(milestonePatchSchema, req.body, "Invalid milestone patch payload");
  const row = await service.patchMilestoneService(projectId, id, payload);
  await recordAudit({ ...actor(req), entityType: "milestone", entityId: String(row.id), action: "PATCH" });
  ok(res, row);
});

export const projectProcurement = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.projectProcurementService(projectId));
});

export const procurementItemsList = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.listProcurementItemsService(projectId));
});

export const createProcurementItem = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "procurement.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const payload = validate(procurementItemCreateSchema, req.body, "Invalid procurement item payload");
  assertBodyProjectContext(projectId, payload);
  const row = await service.createProcurementItemService(projectId, payload);
  await recordAudit({ ...actor(req), entityType: "procurement_item", entityId: String(row.id), action: "CREATE" });
  created(res, row);
});

export const patchProcurementItem = asyncHandler(async (req, res) => {
  assertPermission((req.user as any).role, "procurement.write");
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const { id } = validate(idParamSchema, req.params, "Invalid id");
  const payload = validate(procurementItemPatchSchema, req.body, "Invalid procurement patch payload");
  const row = await service.patchProcurementItemService(projectId, id, payload);
  await recordAudit({ ...actor(req), entityType: "procurement_item", entityId: String(row.id), action: "PATCH" });
  ok(res, row);
});

export const procurementPos = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    assertPermission((req.user as any).role, "procurement.write");
    const payload = validate(procurementPoCreateSchema, req.body, "Invalid purchase order payload");
    assertBodyProjectContext(projectId, payload);
    const row = await service.createPurchaseOrderService(projectId, payload);
    await recordAudit({ ...actor(req), entityType: "purchase_order", entityId: String(row.id), action: "CREATE" });
    return created(res, row);
  }
  if (req.method === "PATCH") {
    assertPermission((req.user as any).role, "procurement.write");
    const { id } = validate(idParamSchema, req.params, "Invalid id");
    const payload = validate(procurementPoPatchSchema, req.body, "Invalid purchase order patch payload");
    const row = await service.patchPurchaseOrderService(projectId, id, payload);
    await recordAudit({ ...actor(req), entityType: "purchase_order", entityId: String(row.id), action: "PATCH" });
    return ok(res, row);
  }
  ok(res, await service.listPurchaseOrdersService(projectId));
});

export const procurementInvoices = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    assertPermission((req.user as any).role, "invoice.write");
    const payload = validate(invoiceCreateSchema, req.body, "Invalid invoice payload");
    assertBodyProjectContext(projectId, payload);
    const row = await service.createInvoiceService(projectId, payload, (req.user as any).id);
    await recordAudit({ ...actor(req), entityType: "invoice", entityId: String(row.id), action: "CREATE" });
    return created(res, row);
  }
  ok(res, await service.listInvoicesService(projectId));
});

export const financeSummary = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.financeSummaryService(projectId));
});

export const financeCashflow = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.financeCashflowService(projectId));
});

export const financeCos = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.financeCosService(projectId));
});

export const financeRevenue = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.financeRevenueService(projectId));
});

export const financeExpenditure = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.financeExpenditureService(projectId));
});

export const financeVariations = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    assertPermission((req.user as any).role, "finance.write");
    const payload = validate(financeVariationCreateSchema, req.body, "Invalid finance variation payload");
    assertBodyProjectContext(projectId, payload);
    const row = await service.createFinanceVariationService(projectId, payload, (req.user as any).id);
    await recordAudit({ ...actor(req), entityType: "finance_variation", entityId: String(row.id), action: "CREATE" });
    return created(res, row);
  }
  if (req.method === "PATCH") {
    assertPermission((req.user as any).role, "finance.write");
    const payload = validate(financeVariationPatchSchema, req.body, "Invalid finance variation patch payload");
    const row = await service.patchFinanceVariationService(projectId, payload.id, payload);
    await recordAudit({ ...actor(req), entityType: "finance_variation", entityId: String(row.id), action: "PATCH" });
    return ok(res, row);
  }
  ok(res, await service.listFinanceVariationsService(projectId));
});

export const importsByDomain = asyncHandler(async (req, res) => {
  const domain = String(req.params.domain || "general");
  ok(res, await service.importsByDomainService(domain));
});

export const lookupsByType = asyncHandler(async (req, res) => {
  const type = String(req.params.type || "");
  ok(res, await service.lookupByTypeService(type));
});

export const auditActivity = asyncHandler(async (_req, res) => ok(res, await service.auditActivityService()));

// Prompt 12: Materialized dashboard metrics endpoint
export const dashboardMetrics = asyncHandler(async (_req, res) => ok(res, await service.dashboardMetricsService()));
export const dashboardRefresh = asyncHandler(async (_req, res) => ok(res, await service.dashboardRefreshService()));

// ─── Prompt 14: Consolidated project endpoints with permissions ────

export const projectDetailConsolidated = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const [data, permissions] = await Promise.all([
    service.getConsolidatedProjectService(projectId),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});

export const projectFinanceDetail = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const [data, permissions] = await Promise.all([
    service.getProjectFinanceDetailService(projectId),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});

export const projectPlanDetail = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const workstream = req.query.workstream ? String(req.query.workstream) : undefined;
  const [data, permissions] = await Promise.all([
    service.getProjectPlanDetailService(projectId, workstream),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});

export const projectQualityDetail = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const [data, permissions] = await Promise.all([
    service.getProjectQualityDetailService(projectId),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});

export const projectEngineeringDetail = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const [data, permissions] = await Promise.all([
    service.getProjectEngineeringDetailService(projectId),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});
