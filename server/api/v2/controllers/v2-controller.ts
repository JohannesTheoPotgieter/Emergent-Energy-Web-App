import type { Request, Response } from "express";
import { db } from "../../../db";
import { counterparties, users, rolePermissions, procurementItems, invoiceCaptures, smartImportRuns, auditEvents, workItems, projectInfo } from "@shared/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { assertPermission } from "../policies/access-policy";
import { recordAudit } from "../services/audit-service";
import * as service from "../services/project-v2-service";
import { asyncHandler, created, ok, paginationQuerySchema, validate } from "../utils/http";
import { invoiceCreateSchema, procurementItemCreateSchema, projectIdParamSchema, workItemCreateSchema, workItemPatchSchema } from "../validators/project-v2-validators";

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as any;
  ok(res, { id: user.id, email: user.email, name: user.name, role: user.role });
});

export const mePermissions = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as any;
  const permissions = await db.select().from(rolePermissions).where(eq(rolePermissions.role, user.role));
  ok(res, { role: user.role, permissions });
});

export const dashboardByRole = asyncHandler(async (req: Request, res: Response) => {
  const role = String(req.params.role || (req.user as any).role);
  const [projects, openWork, openProcurement, invoices] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(projectInfo).where(eq(projectInfo.isActive, true)),
    db.select({ total: sql<number>`count(*)` }).from(workItems).where(and(isNull(workItems.deletedAt), sql`${workItems.status} != 'Complete'`)),
    db.select({ total: sql<number>`count(*)` }).from(procurementItems).where(sql`${procurementItems.status} not in ('closed','received')`),
    db.select({ total: sql<number>`count(*)` }).from(invoiceCaptures).where(sql`${invoiceCaptures.status} in ('captured','submitted','verified')`),
  ]);
  ok(res, {
    role,
    totals: {
      projects: Number(projects[0]?.total ?? 0),
      openWorkItems: Number(openWork[0]?.total ?? 0),
      openProcurement: Number(openProcurement[0]?.total ?? 0),
      pendingInvoices: Number(invoices[0]?.total ?? 0),
    },
  });
});

export const listProjects = asyncHandler(async (req, res) => {
  const query = validate(paginationQuerySchema, req.query, "Invalid pagination query");
  const response = await service.listProjectsService({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 25, sortDir: query.sortDir ?? "asc" });
  ok(res, response.rows, response.meta);
});

export const projectDetail = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectOverviewService(projectId));
});

export const projectOverview = projectDetail;

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
  ok(res, {
    pd: detail.project.pd,
    pdUserId: detail.project.pdUserId,
    phase: detail.project.phase,
    pdHandoverDate: detail.project.pdHandoverDate,
    signedStatus: detail.project.signedStatus,
  });
});

export const developmentHandover = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  assertPermission((req.user as any).role, "development.write");
  await service.developmentHandoverService(projectId, (req.user as any).id, String(req.body?.reason || "handover"));
  await recordAudit({ actorRole: (req.user as any).role, userId: (req.user as any).id, userName: (req.user as any).name, entityType: "project", entityId: String(projectId), action: "DEVELOPMENT_HANDOVER", requestPath: req.path, requestMethod: req.method });
  created(res, { projectId, transitionedTo: "Construction" });
});

export const projectEngineering = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectEngineeringService(projectId));
});

export const engineeringDesigns = projectEngineering;

export const projectQuality = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectQualityService(projectId));
});

export const qualityChecks = projectQuality;

export const projectWorkItems = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await db.select().from(workItems).where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt))).orderBy(desc(workItems.updatedAt)));
});

export const createWorkItem = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const payload = validate(workItemCreateSchema, req.body, "Invalid work item payload");
  const createdRow = await service.createWorkItemService(projectId, payload, (req.user as any).id);
  await recordAudit({ actorRole: (req.user as any).role, userId: (req.user as any).id, entityType: "work_item", entityId: String(createdRow.id), action: "CREATE" });
  created(res, createdRow);
});

export const patchWorkItem = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const id = Number(req.params.id);
  const payload = validate(workItemPatchSchema, req.body, "Invalid work item patch payload");
  ok(res, await service.patchWorkItemService(projectId, id, payload));
});

export const projectMilestones = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectLifecycleService(projectId));
});
export const createMilestone = createWorkItem;
export const patchMilestone = patchWorkItem;

export const projectProcurement = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectOverviewService(projectId));
});

export const procurementItemsList = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await db.select().from(procurementItems).where(eq(procurementItems.projectId, projectId)).orderBy(desc(procurementItems.updatedAt)));
});

export const createProcurementItem = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const payload = validate(procurementItemCreateSchema, req.body, "Invalid procurement item payload");
  created(res, await service.createProcurementItemService(projectId, payload));
});

export const patchProcurementItem = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.patchProcurementItemService(projectId, Number(req.params.id), req.body));
});

export const procurementPos = procurementItemsList;

export const procurementInvoices = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  if (req.method === "POST") {
    const payload = validate(invoiceCreateSchema, req.body, "Invalid invoice payload");
    return created(res, await service.createInvoiceService(projectId, payload, (req.user as any).id));
  }
  ok(res, await db.select().from(invoiceCaptures).where(eq(invoiceCaptures.projectId, projectId)).orderBy(desc(invoiceCaptures.updatedAt)));
});

export const projectFinance = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectOverviewService(projectId));
});

export const financeSummary = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  ok(res, await service.getProjectOverviewService(projectId));
});

export const financeSimpleView = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const summary = await service.getProjectOverviewService(projectId);
  ok(res, summary.finance);
});

export const financeVariations = asyncHandler(async (_req, res) => ok(res, { status: "planned" }));

export const importsByDomain = asyncHandler(async (req, res) => {
  const domain = String(req.params.domain || "general");
  ok(res, await db.select().from(smartImportRuns).where(eq(smartImportRuns.importType, domain)).orderBy(desc(smartImportRuns.startedAt)).limit(50));
});

export const lookupsByType = asyncHandler(async (req, res) => {
  const type = String(req.params.type || "");
  if (type === "users") return ok(res, await db.select({ id: users.id, name: users.name, role: users.role }).from(users).orderBy(asc(users.name)));
  if (type === "counterparties") return ok(res, await db.select().from(counterparties).orderBy(asc(counterparties.nameCanonical)));
  ok(res, []);
});

export const auditActivity = asyncHandler(async (_req, res) => ok(res, await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(200)));
