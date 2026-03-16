import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  approvals,
  auditEvents,
  clients,
  deliverables,
  projectEditableFields,
  projectPhaseHistory,
  users,
  workItemAssignments,
  workItems,
} from "@shared/schema";
import {
  createDepartmentWorkspaceContracts,
  normalizeLifecycleStage,
  normalizeRoleId,
  normalizeWorkflowActionState,
  type PlatformProjectSummaryContract,
  type SharedActivityContract,
  type SharedAssigneeContract,
  type SharedKpiContract,
} from "@shared/platform-contracts";
import { db } from "../db";
import { storage } from "../storage";
import {
  type CanonicalProjectFinanceRow,
  type CanonicalProjectTaskRow,
  getCanonicalFinanceByProjectIds,
  getCanonicalTaskSummaryByProjectIds,
} from "./canonical-dashboard-kpi-service";

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const asDate = new Date(text);
  return Number.isNaN(asDate.getTime()) ? text : asDate.toISOString();
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeApprovalSummary() {
  return { total: 0, pending: 0, approved: 0, rejected: 0 };
}

function makeDeliverableSummary() {
  return { total: 0, pending: 0, inReview: 0, completed: 0 };
}

function addAssignee(
  target: SharedAssigneeContract[],
  seen: Set<string>,
  assignee: SharedAssigneeContract,
) {
  const key = [
    assignee.assignmentRole,
    assignee.userId ?? "none",
    assignee.roleId ?? "none",
    assignee.displayName ?? "none",
    assignee.sourceEntityType,
    assignee.sourceEntityId,
  ].join(":");
  if (seen.has(key)) return;
  seen.add(key);
  target.push(assignee);
}

function buildKpis(params: {
  finance?: CanonicalProjectFinanceRow;
  tasks?: CanonicalProjectTaskRow;
  approvalSummary: ReturnType<typeof makeApprovalSummary>;
  deliverableSummary: ReturnType<typeof makeDeliverableSummary>;
}): SharedKpiContract[] {
  return [
    {
      id: "finance_total_revenue",
      name: "Total Revenue",
      value: toNumber(params.finance?.totalRevenue),
      unit: "currency",
      sourceTable: "normalized_revenue_lines",
      sourceService: "canonical-dashboard-kpi-service",
    },
    {
      id: "finance_total_cost",
      name: "Total Cost",
      value: toNumber(params.finance?.totalCost),
      unit: "currency",
      sourceTable: "normalized_cost_lines",
      sourceService: "canonical-dashboard-kpi-service",
    },
    {
      id: "tasks_active",
      name: "Active Work Items",
      value: toNumber(params.tasks?.active),
      unit: "count",
      sourceTable: "work_items",
      sourceService: "canonical-dashboard-kpi-service",
    },
    {
      id: "tasks_overdue",
      name: "Overdue Work Items",
      value: toNumber(params.tasks?.overdue),
      unit: "count",
      sourceTable: "work_items",
      sourceService: "canonical-dashboard-kpi-service",
    },
    {
      id: "approvals_pending",
      name: "Pending Approvals",
      value: params.approvalSummary.pending,
      unit: "count",
      sourceTable: "approvals",
      sourceService: "project-platform-summary-service",
    },
    {
      id: "deliverables_completed",
      name: "Completed Deliverables",
      value: params.deliverableSummary.completed,
      unit: "count",
      sourceTable: "deliverables",
      sourceService: "project-platform-summary-service",
    },
  ];
}

function toActivityContract(params: {
  projectId: number;
  latestUpdateAt: string | null;
  latestUpdateBy: string | null;
  auditAt: string | null;
  auditSummary: string | null;
  auditActor: string | null;
  phaseAt: string | null;
  phaseSummary: string | null;
}): SharedActivityContract {
  const candidates: Array<{
    when: string | null;
    summary: string | null;
    actor: string | null;
    sourceTable: SharedActivityContract["sourceTable"];
  }> = [
    {
      when: params.auditAt,
      summary: params.auditSummary,
      actor: params.auditActor,
      sourceTable: "audit_events",
    },
    {
      when: params.latestUpdateAt,
      summary: params.latestUpdateAt ? "Latest update changed" : null,
      actor: params.latestUpdateBy,
      sourceTable: "project_editable_fields",
    },
    {
      when: params.phaseAt,
      summary: params.phaseSummary,
      actor: null,
      sourceTable: "project_phase_history",
    },
  ];

  const winner = candidates.sort((left, right) => toTimestamp(right.when) - toTimestamp(left.when))[0];
  return {
    projectId: params.projectId,
    lastActivityAt: winner?.when || null,
    lastActivitySummary: winner?.summary || null,
    lastActivityActor: winner?.actor || null,
    sourceTable: winner?.sourceTable || "audit_events",
  };
}

export async function getPlatformProjectSummaryMap(params?: {
  projectIds?: number[];
  projectNames?: string[];
}): Promise<Map<number, PlatformProjectSummaryContract>> {
  const requestedProjectIds = params?.projectIds?.filter((value): value is number => Number.isFinite(value)) || [];
  const requestedProjectNames = params?.projectNames?.filter(Boolean) || [];
  const projectRows = (await storage.getAllProjectInfo()).filter((row) => {
    if (requestedProjectIds.length > 0) {
      return requestedProjectIds.includes(row.id);
    }
    if (requestedProjectNames.length > 0) {
      return requestedProjectNames.includes(row.projectName);
    }
    return true;
  });

  if (projectRows.length === 0) {
    return new Map();
  }

  const projectIds = projectRows.map((row) => row.id);
  const projectNames = projectRows.map((row) => row.projectName);
  const explicitUserIds = new Set<number>();
  for (const row of projectRows) {
    if (row.pmUserId) explicitUserIds.add(row.pmUserId);
    if (row.pdUserId) explicitUserIds.add(row.pdUserId);
  }

  const [
    editableRows,
    approvalRows,
    deliverableRows,
    auditRows,
    phaseHistoryRows,
    assignmentRows,
    ownerFallbackRows,
    financeByProject,
    taskByProject,
    clientRows,
  ] = await Promise.all([
    db
      .select({
        projectName: projectEditableFields.projectName,
        latestUpdate: projectEditableFields.latestUpdate,
        latestUpdateAt: projectEditableFields.latestUpdateAt,
        latestUpdateBy: projectEditableFields.latestUpdateBy,
        updatedAt: projectEditableFields.updatedAt,
      })
      .from(projectEditableFields)
      .where(inArray(projectEditableFields.projectName, projectNames)),
    db.select().from(approvals).where(inArray(approvals.projectId, projectIds)),
    db.select().from(deliverables).where(inArray(deliverables.projectId, projectIds)),
    db.select().from(auditEvents).where(inArray(auditEvents.projectName, projectNames)).orderBy(desc(auditEvents.createdAt)),
    db.select().from(projectPhaseHistory).where(inArray(projectPhaseHistory.projectId, projectIds)).orderBy(desc(projectPhaseHistory.changedAt)),
    db
      .select({
        projectId: workItems.projectId,
        workItemId: workItemAssignments.workItemId,
        assignmentRole: workItemAssignments.role,
        userId: workItemAssignments.userId,
        displayName: users.name,
      })
      .from(workItemAssignments)
      .innerJoin(workItems, eq(workItemAssignments.workItemId, workItems.id))
      .leftJoin(users, eq(workItemAssignments.userId, users.id))
      .where(and(inArray(workItems.projectId, projectIds), isNull(workItems.deletedAt))),
    db
      .select({
        projectId: workItems.projectId,
        workItemId: workItems.id,
        userId: workItems.ownerUserId,
        displayName: users.name,
      })
      .from(workItems)
      .leftJoin(users, eq(workItems.ownerUserId, users.id))
      .where(and(inArray(workItems.projectId, projectIds), isNull(workItems.deletedAt))),
    getCanonicalFinanceByProjectIds(projectIds),
    getCanonicalTaskSummaryByProjectIds(projectIds),
    projectRows.some((row) => row.clientId != null)
      ? db
          .select({
            id: clients.id,
            name: clients.name,
          })
          .from(clients)
          .where(inArray(clients.id, projectRows.map((row) => row.clientId).filter((value): value is number => value != null)))
      : Promise.resolve([]),
  ]);

  for (const row of assignmentRows) {
    if (row.userId) explicitUserIds.add(row.userId);
  }
  for (const row of ownerFallbackRows) {
    if (row.userId) explicitUserIds.add(row.userId);
  }

  const userRows = explicitUserIds.size > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, Array.from(explicitUserIds)))
    : [];

  const editableByProject = new Map<string, (typeof editableRows)[number]>();
  for (const row of editableRows) {
    editableByProject.set(row.projectName, row);
  }
  const auditByProject = new Map<string, (typeof auditRows)[number]>();
  for (const row of auditRows) {
    if (row.projectName && !auditByProject.has(row.projectName)) {
      auditByProject.set(row.projectName, row);
    }
  }
  const phaseByProject = new Map<number, (typeof phaseHistoryRows)[number]>();
  for (const row of phaseHistoryRows) {
    if (!phaseByProject.has(row.projectId)) {
      phaseByProject.set(row.projectId, row);
    }
  }
  const clientNameById = new Map<number, string>();
  for (const row of clientRows) {
    clientNameById.set(row.id, row.name);
  }
  const userNameById = new Map<number, string>();
  for (const row of userRows) {
    userNameById.set(row.id, row.name);
  }
  const approvalSummaryByProject = new Map<number, ReturnType<typeof makeApprovalSummary>>();
  const deliverableSummaryByProject = new Map<number, ReturnType<typeof makeDeliverableSummary>>();
  const assigneesByProject = new Map<number, SharedAssigneeContract[]>();
  const assigneeSeenByProject = new Map<number, Set<string>>();

  for (const row of approvalRows) {
    const entry = approvalSummaryByProject.get(row.projectId) || makeApprovalSummary();
    entry.total += 1;
    const status = normalizeWorkflowActionState("approval", row.status);
    if (status === "approved") entry.approved += 1;
    else if (status === "rejected") entry.rejected += 1;
    else entry.pending += 1;
    approvalSummaryByProject.set(row.projectId, entry);
  }

  for (const row of deliverableRows) {
    const entry = deliverableSummaryByProject.get(row.projectId) || makeDeliverableSummary();
    entry.total += 1;
    const status = normalizeWorkflowActionState("deliverable", row.status);
    if (status === "complete" || status === "approved") entry.completed += 1;
    else if (status === "in_review") entry.inReview += 1;
    else entry.pending += 1;
    deliverableSummaryByProject.set(row.projectId, entry);
  }

  for (const row of assignmentRows) {
    const target = assigneesByProject.get(row.projectId) || [];
    const seen = assigneeSeenByProject.get(row.projectId) || new Set<string>();
    addAssignee(target, seen, {
      assignmentRole: row.assignmentRole,
      userId: row.userId,
      roleId: null,
      displayName: row.displayName || userNameById.get(row.userId) || null,
      sourceTable: "work_item_assignments",
      sourceEntityType: "work_item",
      sourceEntityId: String(row.workItemId),
      canonical: true,
    });
    assigneesByProject.set(row.projectId, target);
    assigneeSeenByProject.set(row.projectId, seen);
  }

  for (const row of ownerFallbackRows) {
    if (!row.userId) continue;
    const target = assigneesByProject.get(row.projectId) || [];
    const seen = assigneeSeenByProject.get(row.projectId) || new Set<string>();
    addAssignee(target, seen, {
      assignmentRole: "OWNER",
      userId: row.userId,
      roleId: null,
      displayName: row.displayName || userNameById.get(row.userId) || null,
      sourceTable: "work_items",
      sourceEntityType: "work_item",
      sourceEntityId: String(row.workItemId),
      canonical: false,
    });
    assigneesByProject.set(row.projectId, target);
    assigneeSeenByProject.set(row.projectId, seen);
  }

  const summaries = new Map<number, PlatformProjectSummaryContract>();

  for (const row of projectRows) {
    const editable = editableByProject.get(row.projectName);
    const lifecycle = normalizeLifecycleStage(row.executionPhase || row.phase);
    const approvalSummary = approvalSummaryByProject.get(row.id) || makeApprovalSummary();
    const deliverableSummary = deliverableSummaryByProject.get(row.id) || makeDeliverableSummary();
    const phaseHistory = phaseByProject.get(row.id);
    const audit = auditByProject.get(row.projectName);
    const finance = financeByProject.get(row.id);
    const tasks = taskByProject.get(row.id);
    const assignees = assigneesByProject.get(row.id) || [];
    const seen = assigneeSeenByProject.get(row.id) || new Set<string>();

    if (row.pmUserId || row.pm) {
      addAssignee(assignees, seen, {
        assignmentRole: "OWNER",
        userId: row.pmUserId || null,
        roleId: normalizeRoleId("PROGRAM_MANAGER"),
        displayName: row.pm || (row.pmUserId ? userNameById.get(row.pmUserId) || null : null),
        sourceTable: "project_info",
        sourceEntityType: "project",
        sourceEntityId: String(row.id),
        canonical: false,
      });
    }

    if (row.pdUserId || row.pd) {
      addAssignee(assignees, seen, {
        assignmentRole: "OWNER",
        userId: row.pdUserId || null,
        roleId: normalizeRoleId("PROJECT_DEVELOPER"),
        displayName: row.pd || (row.pdUserId ? userNameById.get(row.pdUserId) || null : null),
        sourceTable: "project_info",
        sourceEntityType: "project",
        sourceEntityId: String(row.id),
        canonical: false,
      });
    }

    const latestUpdateAt = toIsoString(editable?.latestUpdateAt);
    const latestUpdateBy = editable?.latestUpdateBy || null;
    const phaseAt = toIsoString(phaseHistory?.changedAt);
    const phaseSummary = phaseHistory
      ? `Phase changed from ${phaseHistory.fromPhase || "None"} to ${phaseHistory.toPhase}`
      : null;

    summaries.set(row.id, {
      project: {
        canonicalProjectId: row.canonicalProjectId || row.id,
        projectInfoId: row.id,
        projectName: row.projectName,
        clientId: row.clientId || null,
        clientName: row.clientId ? clientNameById.get(row.clientId) || null : null,
        lifecycleStage: lifecycle.lifecycleStage,
        lifecycleStageLabel: lifecycle.phaseLabel,
        rawPhase: lifecycle.rawPhase,
        executionPhase: row.executionPhase || null,
        pmUserId: row.pmUserId || null,
        pdUserId: row.pdUserId || null,
        pmName: row.pm || (row.pmUserId ? userNameById.get(row.pmUserId) || null : null),
        pdName: row.pd || (row.pdUserId ? userNameById.get(row.pdUserId) || null : null),
        isActive: row.isActive !== false && String(row.archivedStatus || "ACTIVE").toUpperCase() !== "ARCHIVED",
        authoritativeTable: "project_info",
      },
      workspaces: createDepartmentWorkspaceContracts(row.id, lifecycle.lifecycleStage),
      assignees,
      latestUpdate: {
        projectId: row.id,
        text: editable?.latestUpdate || null,
        updatedAt: latestUpdateAt,
        updatedBy: latestUpdateBy,
        sourceTable: "project_editable_fields",
      },
      activity: toActivityContract({
        projectId: row.id,
        latestUpdateAt,
        latestUpdateBy,
        auditAt: toIsoString(audit?.createdAt),
        auditSummary: audit ? `${audit.entityType}.${audit.action}` : null,
        auditActor: audit?.userName || null,
        phaseAt,
        phaseSummary,
      }),
      workflow: {
        approvals: approvalSummary,
        deliverables: deliverableSummary,
      },
      kpis: buildKpis({
        finance,
        tasks,
        approvalSummary,
        deliverableSummary,
      }),
    });
  }

  return summaries;
}

export async function getPlatformProjectSummary(projectId: number): Promise<PlatformProjectSummaryContract | null> {
  const summaryMap = await getPlatformProjectSummaryMap({ projectIds: [projectId] });
  return summaryMap.get(projectId) || null;
}
