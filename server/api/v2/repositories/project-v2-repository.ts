import { and, asc, count, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db } from "../../../db";
import { invoiceCaptures, procurementItems, projectInfo, projectPhaseHistory, workItems, normalizedCostLines, normalizedRevenueLines, qcChecklist, qcItemInstance, projectEngStages, projectEngDeliverables } from "@shared/schema";

export async function listProjects(params: { q?: string; page: number; pageSize: number; sortBy?: string; sortDir: "asc" | "desc" }) {
  const filters = [eq(projectInfo.isActive, true)];
  if (params.q) filters.push(ilike(projectInfo.projectName, `%${params.q}%`));
  const where = and(...filters);

  const totalRow = await db.select({ total: count() }).from(projectInfo).where(where);
  const order = params.sortDir === "desc" ? desc(projectInfo.updatedAt) : asc(projectInfo.updatedAt);
  const rows = await db.select().from(projectInfo).where(where).orderBy(order).limit(params.pageSize).offset((params.page - 1) * params.pageSize);
  return { rows, total: Number(totalRow[0]?.total ?? 0) };
}

export async function getProjectById(projectId: number) {
  const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1);
  return project ?? null;
}

export async function getProjectLifecycle(projectId: number) {
  return db.select().from(projectPhaseHistory).where(eq(projectPhaseHistory.projectId, projectId)).orderBy(desc(projectPhaseHistory.changedAt));
}

export async function getProjectWorkItems(projectId: number, isMilestone?: boolean) {
  const filters = [eq(workItems.projectId, projectId), isNull(workItems.deletedAt)];
  if (typeof isMilestone === "boolean") filters.push(eq(workItems.isMilestone, isMilestone));
  return db.select().from(workItems).where(and(...filters)).orderBy(desc(workItems.updatedAt));
}

export async function getProjectProcurement(projectId: number) {
  const [items, invoices] = await Promise.all([
    db.select().from(procurementItems).where(eq(procurementItems.projectId, projectId)).orderBy(desc(procurementItems.updatedAt)),
    db.select().from(invoiceCaptures).where(eq(invoiceCaptures.projectId, projectId)).orderBy(desc(invoiceCaptures.updatedAt)),
  ]);
  return { items, invoices };
}

export async function getProjectFinanceSummary(projectId: number) {
  const [cos, revenue] = await Promise.all([
    db.select({ planned: sql<number>`coalesce(sum(${normalizedCostLines.plannedAmount}),0)`, actual: sql<number>`coalesce(sum(${normalizedCostLines.actualAmount}),0)` }).from(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId)),
    db.select({ planned: sql<number>`coalesce(sum(${normalizedRevenueLines.plannedAmount}),0)`, actual: sql<number>`coalesce(sum(${normalizedRevenueLines.actualAmount}),0)` }).from(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectId, projectId)),
  ]);
  return {
    cost: cos[0] ?? { planned: 0, actual: 0 },
    revenue: revenue[0] ?? { planned: 0, actual: 0 },
  };
}

export async function getProjectEngineering(projectId: number) {
  const [stages, designs] = await Promise.all([
    db.select().from(projectEngStages).where(eq(projectEngStages.projectId, projectId)).orderBy(desc(projectEngStages.createdAt)),
    db.select({
      id: projectEngDeliverables.id,
      projectEngStageId: projectEngDeliverables.projectEngStageId,
      fileName: projectEngDeliverables.fileName,
      approvalStatus: projectEngDeliverables.approvalStatus,
      uploadedAt: projectEngDeliverables.uploadedAt,
      notes: projectEngDeliverables.notes,
    }).from(projectEngDeliverables)
      .innerJoin(projectEngStages, eq(projectEngStages.id, projectEngDeliverables.projectEngStageId))
      .where(eq(projectEngStages.projectId, projectId))
      .orderBy(desc(projectEngDeliverables.uploadedAt)),
  ]);
  return { stages, designs };
}

export async function getProjectQuality(projectId: number) {
  const checklistRows = await db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId));
  if (!checklistRows.length) return { checklists: [], checks: [] };
  const checks = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklistRows[0].id));
  return { checklists: checklistRows, checks };
}
