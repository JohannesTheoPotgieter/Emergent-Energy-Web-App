import { db } from "../../../db";
import { invoiceCaptures, procurementItems, projectPhaseHistory, workItems } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
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

export async function developmentHandoverService(projectId: number, userId: number, reason: string) {
  await db.insert(projectPhaseHistory).values({
    projectId,
    fromPhase: "Development",
    toPhase: "Construction",
    changedByUserId: userId,
    reason,
  });
}

export async function createWorkItemService(projectId: number, payload: any, userId: number) {
  const [created] = await db.insert(workItems).values({ ...payload, projectId, createdBy: userId }).returning();
  return created;
}

export async function patchWorkItemService(projectId: number, id: number, payload: any) {
  const [updated] = await db
    .update(workItems)
    .set({ ...payload, updatedAt: new Date() })
    .where(and(eq(workItems.projectId, projectId), eq(workItems.id, id), isNull(workItems.deletedAt)))
    .returning();
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Work item not found");
  return updated;
}

export async function createProcurementItemService(projectId: number, payload: any) {
  const [created] = await db.insert(procurementItems).values({ ...payload, projectId }).returning();
  return created;
}

export async function patchProcurementItemService(projectId: number, id: number, payload: any) {
  const [updated] = await db.update(procurementItems).set({ ...payload, updatedAt: new Date() }).where(and(eq(procurementItems.projectId, projectId), eq(procurementItems.id, id))).returning();
  if (!updated) throw new ApiV2Error("NOT_FOUND", 404, "Procurement item not found");
  return updated;
}

export async function createInvoiceService(projectId: number, payload: any, userId: number) {
  const [created] = await db.insert(invoiceCaptures).values({ ...payload, projectId, capturedByUserId: userId }).returning();
  return created;
}
