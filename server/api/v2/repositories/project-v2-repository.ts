import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../../db";
import { auditEvents, invoiceCaptures, normalizedCostLines, normalizedRevenueLines, procurementItems, projectEngDeliverables, projectEngStages, projectInfo, projectPhaseHistory, projectRevenueSummary, qcChecklist, qcItemInstance, smartImportRuns, workItems, users, counterparties, projectExecutionState, projectSettings, projectTeamMembers, dashboardProjectMetrics, qcWarning, qcItemEvidence } from "@shared/schema";
import { syncProjectSplitTables } from "../../../lib/project-info-sync";

export async function listProjects(params: { q?: string; page: number; pageSize: number; sortBy?: string; sortDir: "asc" | "desc"; scopeProjectIds?: Set<number> | null }) {
  const filters = [eq(projectInfo.isActive, true)];
  if (params.q) filters.push(ilike(projectInfo.projectName, `%${params.q}%`));

  // RLS: scope to user's assigned projects when provided
  if (params.scopeProjectIds != null) {
    if (params.scopeProjectIds.size === 0) {
      return { rows: [], total: 0 };
    }
    const ids = [...params.scopeProjectIds];
    filters.push(inArray(projectInfo.id, ids));
  }

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

export async function transitionProjectToConstruction(projectId: number, userId: number, reason: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1);
    if (!current) return null;
    if ((current.phase ?? "Development") !== "Development") {
      return { invalidTransition: true as const, currentPhase: current.phase ?? "Development" };
    }
    const fromPhase = current.phase ?? "Development";

    await tx.insert(projectPhaseHistory).values({ projectId, fromPhase, toPhase: "Construction", changedByUserId: userId, reason });
    const constructionFields = { phase: "Construction", phaseUpdatedAt: new Date(), phaseUpdatedByUserId: userId, pdHandoverActual: new Date().toISOString().slice(0, 10), updatedAt: new Date() };
    const [updated] = await tx
      .update(projectInfo)
      .set(constructionFields)
      .where(eq(projectInfo.id, projectId))
      .returning();
    await syncProjectSplitTables(projectId, constructionFields, tx);
    return updated;
  });
}

export async function getProjectLifecycle(projectId: number) {
  return db.select().from(projectPhaseHistory).where(eq(projectPhaseHistory.projectId, projectId)).orderBy(desc(projectPhaseHistory.changedAt));
}

export async function getProjectWorkItems(projectId: number, isMilestone?: boolean) {
  const filters = [eq(workItems.projectId, projectId), isNull(workItems.deletedAt)];
  if (typeof isMilestone === "boolean") filters.push(eq(workItems.isMilestone, isMilestone));
  return db.select().from(workItems).where(and(...filters)).orderBy(desc(workItems.updatedAt));
}

export async function createWorkItem(projectId: number, payload: any, userId: number) {
  const [existing] = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.title, payload.title),
        eq(workItems.workstream, payload.workstream),
        eq(workItems.isMilestone, Boolean(payload.isMilestone)),
        isNull(workItems.deletedAt),
      ),
    )
    .orderBy(desc(workItems.updatedAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(workItems).values({ ...payload, projectId, createdBy: userId }).returning();
  return created;
}

export async function patchWorkItem(projectId: number, id: number, payload: any) {
  const [updated] = await db.update(workItems).set({ ...payload, updatedAt: new Date() }).where(and(eq(workItems.projectId, projectId), eq(workItems.id, id), isNull(workItems.deletedAt))).returning();
  return updated ?? null;
}

export async function getMilestones(projectId: number) {
  return getProjectWorkItems(projectId, true);
}

export async function getProjectProcurement(projectId: number) {
  const [items, invoices] = await Promise.all([
    db.select().from(procurementItems).where(eq(procurementItems.projectId, projectId)).orderBy(desc(procurementItems.updatedAt)),
    db.select().from(invoiceCaptures).where(eq(invoiceCaptures.projectId, projectId)).orderBy(desc(invoiceCaptures.updatedAt)),
  ]);
  return {
    items,
    invoices,
    summary: {
      openItems: items.filter((item) => !["closed", "received"].includes(String(item.status ?? ""))).length,
      pendingInvoices: invoices.filter((invoice) => ["captured", "submitted", "verified"].includes(String(invoice.status ?? ""))).length,
    },
  };
}

export async function listProcurementItems(projectId: number) {
  return db.select().from(procurementItems).where(eq(procurementItems.projectId, projectId)).orderBy(desc(procurementItems.updatedAt));
}

export async function createProcurementItem(projectId: number, payload: any) {
  const [created] = await db.insert(procurementItems).values({ ...payload, projectId }).returning();
  return created;
}

export async function patchProcurementItem(projectId: number, id: number, payload: any) {
  const [updated] = await db.update(procurementItems).set({ ...payload, updatedAt: new Date() }).where(and(eq(procurementItems.projectId, projectId), eq(procurementItems.id, id))).returning();
  return updated ?? null;
}

export async function listPurchaseOrders(projectId: number) {
  return db.select().from(procurementItems).where(and(eq(procurementItems.projectId, projectId), sql`${procurementItems.poId} is not null`)).orderBy(desc(procurementItems.updatedAt));
}

export async function createPurchaseOrder(projectId: number, payload: any) {
  return createProcurementItem(projectId, { ...payload, status: payload.status ?? "ordered", category: payload.category ?? "service" });
}

export async function patchPurchaseOrder(projectId: number, id: number, payload: any) {
  return patchProcurementItem(projectId, id, payload);
}

export async function listInvoices(projectId: number) {
  return db.select().from(invoiceCaptures).where(eq(invoiceCaptures.projectId, projectId)).orderBy(desc(invoiceCaptures.updatedAt));
}

export async function createInvoice(projectId: number, payload: any, userId: number) {
  const [created] = await db.insert(invoiceCaptures).values({ ...payload, projectId, capturedByUserId: userId }).returning();
  return created;
}

export async function getProjectFinanceSummary(projectId: number) {
  const [cos, revenue, budgetAgg, costedSummary] = await Promise.all([
    db.select({ planned: sql<number>`coalesce(sum(cast(${normalizedCostLines.amountExVat} as numeric)),0)`, actual: sql<number>`coalesce(sum(case when ${normalizedCostLines.status} in ('APPROVED','PAID') then cast(${normalizedCostLines.amountExVat} as numeric) else 0 end),0)` }).from(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId)),
    db.select({ planned: sql<number>`coalesce(sum(cast(${normalizedRevenueLines.amountExVat} as numeric)),0)`, actual: sql<number>`coalesce(sum(case when ${normalizedRevenueLines.status} in ('INVOICED','PAID','IN_BANK','REALISED') then cast(${normalizedRevenueLines.amountExVat} as numeric) else 0 end),0)` }).from(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectId, projectId)),
    db.select({ budgetTotal: sql<number>`coalesce(sum(cast(${normalizedCostLines.budgetTotal} as numeric)),0)` }).from(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId)),
    db.select().from(projectRevenueSummary).where(eq(projectRevenueSummary.projectId, projectId)).limit(1),
  ]);
  return {
    cost: cos[0] ?? { planned: 0, actual: 0 },
    revenue: revenue[0] ?? { planned: 0, actual: 0 },
    budget: { total: budgetAgg[0]?.budgetTotal ?? 0 },
    costedSummary: costedSummary[0] ?? null,
  };
}

export async function getFinanceCashflow(projectId: number) {
  return db.select({ status: normalizedCostLines.status, projected: sql<number>`coalesce(sum(cast(${normalizedCostLines.amountExVat} as numeric)),0)`, actual: sql<number>`coalesce(sum(case when ${normalizedCostLines.status} in ('APPROVED','PAID') then cast(${normalizedCostLines.amountExVat} as numeric) else 0 end),0)` })
    .from(normalizedCostLines)
    .where(eq(normalizedCostLines.projectId, projectId))
    .groupBy(normalizedCostLines.status);
}

export async function getFinanceRevenueLines(projectId: number) {
  return db.select({ id: normalizedRevenueLines.id, status: normalizedRevenueLines.status, amountExVat: normalizedRevenueLines.amountExVat, invoiceDate: normalizedRevenueLines.invoiceDate, paidDate: normalizedRevenueLines.paidDate, expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate })
    .from(normalizedRevenueLines)
    .where(eq(normalizedRevenueLines.projectId, projectId))
    .orderBy(desc(normalizedRevenueLines.id))
    .limit(100);
}

export async function getFinanceCostLines(projectId: number) {
  return db.select({ id: normalizedCostLines.id, status: normalizedCostLines.status, amountExVat: normalizedCostLines.amountExVat, invoiceDate: normalizedCostLines.invoiceDate, paidDate: normalizedCostLines.paidDate, poNumber: normalizedCostLines.poNumber })
    .from(normalizedCostLines)
    .where(eq(normalizedCostLines.projectId, projectId))
    .orderBy(desc(normalizedCostLines.id))
    .limit(100);
}

export async function listFinanceVariations(projectId: number) {
  return db.select().from(workItems).where(and(eq(workItems.projectId, projectId), eq(workItems.workstream, "FINANCE"), eq(workItems.type, "VARIATION"), isNull(workItems.deletedAt))).orderBy(desc(workItems.updatedAt));
}

export async function createFinanceVariation(projectId: number, payload: any, userId: number) {
  return createWorkItem(projectId, { ...payload, workstream: "FINANCE", type: "VARIATION", status: payload.status ?? "Not Started" }, userId);
}

export async function patchFinanceVariation(projectId: number, id: number, payload: any) {
  return patchWorkItem(projectId, id, payload);
}

export async function getProjectEngineering(projectId: number) {
  const [stages, designs] = await Promise.all([
    db.select().from(projectEngStages).where(eq(projectEngStages.projectId, projectId)).orderBy(desc(projectEngStages.createdAt)),
    listEngineeringDesigns(projectId),
  ]);
  return { stages, designs };
}

export async function listEngineeringDesigns(projectId: number) {
  return db.select({
    id: projectEngDeliverables.id,
    projectEngStageId: projectEngDeliverables.projectEngStageId,
    fileName: projectEngDeliverables.fileName,
    storageRef: projectEngDeliverables.storageRef,
    approvalStatus: projectEngDeliverables.approvalStatus,
    uploadedAt: projectEngDeliverables.uploadedAt,
    notes: projectEngDeliverables.notes,
  }).from(projectEngDeliverables)
    .innerJoin(projectEngStages, eq(projectEngStages.id, projectEngDeliverables.projectEngStageId))
    .where(eq(projectEngStages.projectId, projectId))
    .orderBy(desc(projectEngDeliverables.uploadedAt));
}

export async function createEngineeringDesign(payload: any, userId: number) {
  const [stage] = await db.select({ id: projectEngStages.id }).from(projectEngStages).where(eq(projectEngStages.id, payload.projectEngStageId)).limit(1);
  if (!stage) return null;
  const [created] = await db.insert(projectEngDeliverables).values({ ...payload, uploadedBy: userId }).returning();
  return created;
}

export async function patchEngineeringDesign(id: number, payload: any, userId: number) {
  const [updated] = await db.update(projectEngDeliverables).set({ ...payload, approvedBy: payload.approvalStatus === "approved" ? userId : undefined, approvedAt: payload.approvalStatus === "approved" ? new Date() : undefined }).where(eq(projectEngDeliverables.id, id)).returning();
  return updated ?? null;
}

export async function getProjectQuality(projectId: number) {
  const checklists = await db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId));
  if (!checklists.length) return { checklists: [], checks: [] };
  const checks = await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklists.map((c) => c.id))).orderBy(desc(qcItemInstance.lastUpdatedAt));
  return { checklists, checks };
}

export async function listQualityChecks(projectId: number) {
  return getProjectQuality(projectId);
}

export async function createQualityCheck(payload: any) {
  const [created] = await db.insert(qcItemInstance).values(payload).returning();
  return created;
}

export async function getChecklistByProject(projectId: number, checklistId: number) {
  const [checklist] = await db
    .select({ id: qcChecklist.id })
    .from(qcChecklist)
    .where(and(eq(qcChecklist.projectId, projectId), eq(qcChecklist.id, checklistId)))
    .limit(1);
  return checklist ?? null;
}

export async function patchQualityCheck(id: number, payload: any) {
  const [updated] = await db.update(qcItemInstance).set({ ...payload, lastUpdatedAt: new Date(), approvedAt: payload.approved ? new Date() : undefined }).where(eq(qcItemInstance.id, id)).returning();
  return updated ?? null;
}

export async function listImportsByDomain(domain: string) {
  return db.select().from(smartImportRuns).where(eq(smartImportRuns.importType, domain)).orderBy(desc(smartImportRuns.uploadedAt)).limit(50);
}

export async function listLookupUsers() {
  return db.select({ id: users.id, name: users.name, role: users.role }).from(users).orderBy(asc(users.name));
}

export async function listLookupCounterparties() {
  return db.select().from(counterparties).orderBy(asc(counterparties.nameCanonical));
}

export async function listAuditActivity() {
  return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(200);
}

export async function dashboardCoreTotals(scopeProjectIds?: Set<number> | null) {
  // RLS: when scoped, filter all counts to user's assigned projects
  const hasScope = scopeProjectIds != null && scopeProjectIds.size > 0;
  const ids = hasScope ? [...scopeProjectIds!] : [];

  if (scopeProjectIds != null && scopeProjectIds.size === 0) {
    return { projects: 0, openWorkItems: 0, openProcurement: 0, pendingInvoices: 0 };
  }

  const projectFilter = hasScope
    ? and(eq(projectInfo.isActive, true), inArray(projectInfo.id, ids))
    : eq(projectInfo.isActive, true);

  const workFilter = hasScope
    ? and(isNull(workItems.deletedAt), sql`${workItems.status} != 'Complete'`, inArray(workItems.projectId, ids))
    : and(isNull(workItems.deletedAt), sql`${workItems.status} != 'Complete'`);

  const procFilter = hasScope
    ? and(sql`${procurementItems.status} not in ('closed','received')`, inArray(procurementItems.projectId, ids))
    : sql`${procurementItems.status} not in ('closed','received')`;

  const invFilter = hasScope
    ? and(sql`${invoiceCaptures.status} in ('captured','submitted','verified')`, inArray(invoiceCaptures.projectId, ids))
    : sql`${invoiceCaptures.status} in ('captured','submitted','verified')`;

  const [projects, openWork, openProcurement, invoices] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(projectInfo).where(projectFilter),
    db.select({ total: sql<number>`count(*)` }).from(workItems).where(workFilter),
    db.select({ total: sql<number>`count(*)` }).from(procurementItems).where(procFilter),
    db.select({ total: sql<number>`count(*)` }).from(invoiceCaptures).where(invFilter),
  ]);
  return {
    projects: Number(projects[0]?.total ?? 0),
    openWorkItems: Number(openWork[0]?.total ?? 0),
    openProcurement: Number(openProcurement[0]?.total ?? 0),
    pendingInvoices: Number(invoices[0]?.total ?? 0),
  };
}

// ─── Prompt 14: Consolidated project queries ───────────────────────

export async function getProjectExecutionState(projectId: number) {
  const [row] = await db.select().from(projectExecutionState).where(eq(projectExecutionState.projectId, projectId)).limit(1);
  return row ?? null;
}

export async function getProjectSettings(projectId: number) {
  const [row] = await db.select().from(projectSettings).where(eq(projectSettings.projectId, projectId)).limit(1);
  return row ?? null;
}

export async function getProjectTeam(projectId: number) {
  const rows = await db
    .select({
      id: projectTeamMembers.id,
      userId: projectTeamMembers.userId,
      userName: users.name,
      roleOnProject: projectTeamMembers.roleOnProject,
    })
    .from(projectTeamMembers)
    .leftJoin(users, eq(projectTeamMembers.userId, users.id))
    .where(eq(projectTeamMembers.projectId, projectId));
  return rows;
}

export async function getProjectMetricsFromMaterialized(projectId: number) {
  const [row] = await db.select().from(dashboardProjectMetrics).where(eq(dashboardProjectMetrics.projectId, projectId)).limit(1);
  return row ?? null;
}

export async function getProjectPlanSummary(projectId: number) {
  const items = await db.select().from(workItems).where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)));
  const today = new Date().toISOString().slice(0, 10);
  let total = 0, completed = 0, inProgress = 0, overdue = 0, active = 0;
  for (const t of items) {
    total++;
    const status = String(t.status ?? "").trim().toUpperCase();
    if (["COMPLETE", "COMPLETED", "DONE"].includes(status)) completed++;
    if (status === "IN PROGRESS") inProgress++;
    if (!["COMPLETE", "COMPLETED", "DONE", "CANCELLED", "CANCELED"].includes(status)) active++;
    if (t.endDate && t.endDate < today && !["COMPLETE", "COMPLETED", "DONE", "QC APPROVED"].includes(status)) overdue++;
  }
  return { taskCount: total, tasksCompleted: completed, tasksInProgress: inProgress, tasksOverdue: overdue, tasksActive: active, completionPct: total > 0 ? completed / total : null };
}

export async function getProjectQualitySummary(projectId: number) {
  const [warnings, checklists] = await Promise.all([
    db.select().from(qcWarning).where(and(eq(qcWarning.projectId, projectId), eq(qcWarning.status, "open"))),
    db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId)),
  ]);
  let checklistProgress: number | null = null;
  if (checklists.length > 0) {
    const checklistIds = checklists.map((c) => c.id);
    const instances = await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds));
    const applicable = instances.filter((i) => i.isApplicable);
    const approved = applicable.filter((i) => i.approved);
    checklistProgress = applicable.length > 0 ? approved.length / applicable.length : null;
  }
  return { checklistProgress, openWarnings: warnings.length };
}

export async function getProjectPlanWorkItems(projectId: number, workstreamFilter?: string) {
  const filters = [eq(workItems.projectId, projectId), isNull(workItems.deletedAt)];
  if (workstreamFilter) filters.push(eq(workItems.workstream, workstreamFilter as any));
  return db.select().from(workItems).where(and(...filters));
}

export async function getProjectQualityDetail(projectId: number) {
  const checklists = await db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId));
  let items: any[] = [];
  let evidence: any[] = [];
  if (checklists.length > 0) {
    const checklistIds = checklists.map((c) => c.id);
    [items, evidence] = await Promise.all([
      db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds)),
      db.select().from(qcItemEvidence).where(eq(qcItemEvidence.projectId, projectId)),
    ]);
  }
  return { checklists, items, evidence };
}

export async function getProjectEngineeringDetail(projectId: number) {
  const stages = await db.select().from(projectEngStages).where(eq(projectEngStages.projectId, projectId));
  const engWorkItems = await db.select().from(workItems).where(and(eq(workItems.projectId, projectId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
  let deliverables: any[] = [];
  if (stages.length > 0) {
    const stageIds = stages.map((s) => s.id);
    deliverables = await db.select().from(projectEngDeliverables).where(inArray(projectEngDeliverables.projectEngStageId, stageIds));
  }
  return { stages, workItems: engWorkItems, deliverables };
}
