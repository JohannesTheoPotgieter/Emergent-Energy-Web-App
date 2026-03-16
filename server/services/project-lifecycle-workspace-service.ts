import { desc, sql } from "drizzle-orm";
import type { PlatformProjectSummaryContract } from "@shared/platform-contracts";
import { clients, msObjects, projectInfo, projectPhaseHistory } from "@shared/schema";
import { db } from "../db";
import { getPlatformProjectSummaryMap } from "./project-platform-summary-service";

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function timestampOf(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

type MicrosoftTypeKey = "email" | "event" | "teams" | "sharepoint_file" | "other";

function normalizeMicrosoftType(value: string | null | undefined): MicrosoftTypeKey {
  if (value === "email") return "email";
  if (value === "event") return "event";
  if (value === "teams") return "teams";
  if (value === "sharepoint_file") return "sharepoint_file";
  return "other";
}

interface ProjectMicrosoftSummary {
  totalLinkedItems: number;
  byType: Record<MicrosoftTypeKey, number>;
  latestLinkedAt: string | null;
}

function makeEmptyMicrosoftSummary(): ProjectMicrosoftSummary {
  return {
    totalLinkedItems: 0,
    byType: {
      email: 0,
      event: 0,
      teams: 0,
      sharepoint_file: 0,
      other: 0,
    },
    latestLinkedAt: null,
  };
}

interface PhaseHistorySummary {
  count: number;
  lastChangedAt: string | null;
}

function makeEmptyPhaseHistorySummary(): PhaseHistorySummary {
  return {
    count: 0,
    lastChangedAt: null,
  };
}

interface ProjectLifecycleWorkspaceMetrics {
  totalRevenue: number;
  totalCost: number;
  activeWorkItems: number;
  overdueWorkItems: number;
}

interface ProjectLifecycleWorkspaceClientUpdate {
  projectInfoId: number;
  projectName: string;
  lifecycleStageLabel: string | null;
  text: string;
  updatedAt: string;
  updatedBy: string | null;
  ragStatus: string | null;
  microsoftLinkedItems: number;
}

interface ProjectLifecycleWorkspaceClientLinkedProject {
  projectInfoId: number;
  projectName: string;
  lifecycleStageLabel: string | null;
  isActive: boolean;
  executionGateStatus: string | null;
  executionEnabled: boolean;
  latestUpdateText: string | null;
  latestUpdateAt: string | null;
  latestUpdateBy: string | null;
  totalRevenue: number;
  totalCost: number;
  pendingApprovals: number;
  inReviewDeliverables: number;
  completedDeliverables: number;
  overdueWorkItems: number;
  microsoftLinkedItems: number;
  ragStatus: string | null;
  escalationLevel: string | null;
}

interface ProjectLifecycleWorkspaceClientSignals {
  financial: {
    totalRevenue: number;
    totalCost: number;
    grossMargin: number;
    projectsWithFinancialData: number;
  };
  quality: {
    pendingApprovals: number;
    inReviewDeliverables: number;
    completedDeliverables: number;
  };
  risk: {
    blockedProjects: number;
    projectsMissingLatestUpdate: number;
    overdueWorkItems: number;
    escalatedProjects: number;
    ragRedProjects: number;
    ragAmberProjects: number;
  };
}

interface ProjectLifecycleWorkspaceClientMicrosoftSummary {
  totalLinkedItems: number;
  linkedProjectCount: number;
  latestActivityAt: string | null;
  byType: Record<MicrosoftTypeKey, number>;
}

function getKpiValue(summary: PlatformProjectSummaryContract | undefined, kpiId: string): number {
  return summary?.kpis.find((kpi) => kpi.id === kpiId)?.value ?? 0;
}

function isEscalated(escalationLevel: string | null): boolean {
  const normalized = String(escalationLevel || "").trim().toUpperCase();
  return normalized !== "" && normalized !== "NONE" && normalized !== "LOW";
}

function isBlockedByStageGate(project: Pick<ProjectLifecycleWorkspaceProject, "stageGate">): boolean {
  if (project.stageGate.executionEnabled) return false;
  if ((project.stageGate.executionGateStatus || "").toUpperCase() === "ELIGIBLE") return false;
  if (project.stageGate.signedStatus && project.stageGate.signedStatus !== "NONE") return false;
  return true;
}

function buildEmptyClientSignals(): ProjectLifecycleWorkspaceClientSignals {
  return {
    financial: {
      totalRevenue: 0,
      totalCost: 0,
      grossMargin: 0,
      projectsWithFinancialData: 0,
    },
    quality: {
      pendingApprovals: 0,
      inReviewDeliverables: 0,
      completedDeliverables: 0,
    },
    risk: {
      blockedProjects: 0,
      projectsMissingLatestUpdate: 0,
      overdueWorkItems: 0,
      escalatedProjects: 0,
      ragRedProjects: 0,
      ragAmberProjects: 0,
    },
  };
}

export interface ProjectLifecycleWorkspaceProject {
  projectInfoId: number;
  canonicalProjectId: number;
  projectName: string;
  clientId: number | null;
  clientName: string | null;
  lifecycleStage: string | null;
  lifecycleStageLabel: string | null;
  rawPhase: string | null;
  executionPhase: string | null;
  pmName: string | null;
  pdName: string | null;
  isActive: boolean;
  archivedStatus: string | null;
  phaseUpdatedAt: string | null;
  stageHistory: PhaseHistorySummary;
  stageGate: {
    executionGateStatus: string | null;
    executionEnabled: boolean;
    signedStatus: string | null;
    signedDate: string | null;
  };
  latestUpdate: {
    text: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  workflow: {
    approvals: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    deliverables: {
      total: number;
      pending: number;
      inReview: number;
      completed: number;
    };
  };
  departments: string[];
  microsoft: ProjectMicrosoftSummary;
  ragStatus: string | null;
  escalationLevel: string | null;
  metrics: ProjectLifecycleWorkspaceMetrics;
}

export interface ProjectLifecycleWorkspaceClient {
  clientId: number;
  clientCode: string;
  clientName: string;
  projectCount: number;
  activeProjectCount: number;
  lifecycleStages: string[];
  lifecycleDistribution: Array<{ stage: string; count: number }>;
  departmentCoverage: string[];
  latestUpdateAt: string | null;
  latestUpdateProjectName: string | null;
  microsoftLinkedItems: number;
  latestUpdates: ProjectLifecycleWorkspaceClientUpdate[];
  linkedProjects: ProjectLifecycleWorkspaceClientLinkedProject[];
  signals: ProjectLifecycleWorkspaceClientSignals;
  microsoft: ProjectLifecycleWorkspaceClientMicrosoftSummary;
}

export interface ProjectLifecycleWorkspacePayload {
  generatedAt: string;
  summary: {
    totalProjects: number;
    activeProjects: number;
    projectsWithClientLink: number;
    projectsWithLatestUpdate: number;
    projectsMissingLatestUpdate: number;
    projectsUpdatedInLast7Days: number;
    stageDistribution: Array<{ stage: string; count: number }>;
    gateStatusCounts: Array<{ status: string; count: number }>;
    executionEnabledCount: number;
    microsoftLinkedProjects: number;
    totalMicrosoftLinkedItems: number;
    microsoftByType: Record<MicrosoftTypeKey, number>;
    departmentCoverage: Array<{ department: string; count: number }>;
    totalClients: number;
    clientsWithProjects: number;
  };
  projects: ProjectLifecycleWorkspaceProject[];
  clients: ProjectLifecycleWorkspaceClient[];
}

type WorkspaceProjectRow = {
  id: number;
  canonicalProjectId: number | null;
  projectName: string;
  clientId: number | null;
  phase: string | null;
  executionPhase: string | null;
  pm: string | null;
  pd: string | null;
  isActive: boolean | null;
  archivedStatus: string | null;
  phaseUpdatedAt: unknown;
  executionGateStatus: string | null;
  executionEnabled: boolean | null;
  signedStatus: string | null;
  signedDate: string | null;
  ragStatus: string | null;
  escalationLevel: string | null;
};

type WorkspacePhaseHistoryRow = {
  projectId: number;
  changedAt: unknown;
};

type WorkspaceMicrosoftRow = {
  projectId: number | null;
  type: string | null;
  linkedAt: unknown;
};

type WorkspaceClientRow = {
  id: number;
  clientId: string;
  name: string;
};

export function buildProjectLifecycleWorkspaceFromSources(params: {
  projectRows: WorkspaceProjectRow[];
  phaseHistoryRows: WorkspacePhaseHistoryRow[];
  microsoftRows: WorkspaceMicrosoftRow[];
  clientRows: WorkspaceClientRow[];
  summaryMap: Map<number, PlatformProjectSummaryContract>;
}): ProjectLifecycleWorkspacePayload {
  const { projectRows, phaseHistoryRows, microsoftRows, clientRows, summaryMap } = params;

  const phaseHistoryByProject = new Map<number, PhaseHistorySummary>();
  for (const row of phaseHistoryRows) {
    const existing = phaseHistoryByProject.get(row.projectId) || makeEmptyPhaseHistorySummary();
    existing.count += 1;
    if (!existing.lastChangedAt) {
      existing.lastChangedAt = toIsoString(row.changedAt);
    }
    phaseHistoryByProject.set(row.projectId, existing);
  }

  const microsoftByProject = new Map<number, ProjectMicrosoftSummary>();
  for (const row of microsoftRows) {
    const projectId = Number(row.projectId);
    if (!Number.isFinite(projectId)) continue;
    const existing = microsoftByProject.get(projectId) || makeEmptyMicrosoftSummary();
    existing.totalLinkedItems += 1;
    existing.byType[normalizeMicrosoftType(row.type)] += 1;
    const linkedAt = toIsoString(row.linkedAt);
    if (timestampOf(linkedAt) > timestampOf(existing.latestLinkedAt)) {
      existing.latestLinkedAt = linkedAt;
    }
    microsoftByProject.set(projectId, existing);
  }

  const clientNameById = new Map<number, { clientCode: string; clientName: string }>();
  for (const row of clientRows) {
    clientNameById.set(row.id, {
      clientCode: row.clientId,
      clientName: row.name,
    });
  }

  const projects: ProjectLifecycleWorkspaceProject[] = projectRows.map((row) => {
    const sharedSummary = summaryMap.get(row.id);
    const clientLookup = row.clientId ? clientNameById.get(row.clientId) : null;
    const phaseHistory = phaseHistoryByProject.get(row.id) || makeEmptyPhaseHistorySummary();
    const microsoft = microsoftByProject.get(row.id) || makeEmptyMicrosoftSummary();
    const departments = Array.from(
      new Set((sharedSummary?.workspaces || []).map((workspace) => workspace.departmentId).filter(Boolean)),
    );

    return {
      projectInfoId: row.id,
      canonicalProjectId: sharedSummary?.project.canonicalProjectId || row.canonicalProjectId || row.id,
      projectName: row.projectName,
      clientId: row.clientId || null,
      clientName: sharedSummary?.project.clientName || clientLookup?.clientName || null,
      lifecycleStage: sharedSummary?.project.lifecycleStage || row.executionPhase || row.phase || null,
      lifecycleStageLabel: sharedSummary?.project.lifecycleStageLabel || row.executionPhase || row.phase || null,
      rawPhase: sharedSummary?.project.rawPhase || row.phase || null,
      executionPhase: row.executionPhase || null,
      pmName: sharedSummary?.project.pmName || row.pm || null,
      pdName: sharedSummary?.project.pdName || row.pd || null,
      isActive: sharedSummary?.project.isActive ?? (row.isActive !== false && String(row.archivedStatus || "ACTIVE").toUpperCase() !== "ARCHIVED"),
      archivedStatus: row.archivedStatus || null,
      phaseUpdatedAt: toIsoString(row.phaseUpdatedAt),
      stageHistory: {
        count: phaseHistory.count,
        lastChangedAt: phaseHistory.lastChangedAt || toIsoString(row.phaseUpdatedAt),
      },
      stageGate: {
        executionGateStatus: row.executionGateStatus || null,
        executionEnabled: row.executionEnabled === true,
        signedStatus: row.signedStatus || null,
        signedDate: row.signedDate || null,
      },
      latestUpdate: {
        text: sharedSummary?.latestUpdate.text || null,
        updatedAt: sharedSummary?.latestUpdate.updatedAt || null,
        updatedBy: sharedSummary?.latestUpdate.updatedBy || null,
      },
      workflow: sharedSummary?.workflow || {
        approvals: { total: 0, pending: 0, approved: 0, rejected: 0 },
        deliverables: { total: 0, pending: 0, inReview: 0, completed: 0 },
      },
      departments,
      microsoft,
      ragStatus: row.ragStatus || null,
      escalationLevel: row.escalationLevel || null,
      metrics: {
        totalRevenue: getKpiValue(sharedSummary, "finance_total_revenue"),
        totalCost: getKpiValue(sharedSummary, "finance_total_cost"),
        activeWorkItems: getKpiValue(sharedSummary, "tasks_active"),
        overdueWorkItems: getKpiValue(sharedSummary, "tasks_overdue"),
      },
    };
  });

  projects.sort((left, right) => {
    const activeDelta = Number(right.isActive) - Number(left.isActive);
    if (activeDelta !== 0) return activeDelta;
    return left.projectName.localeCompare(right.projectName);
  });

  const stageDistributionMap = new Map<string, number>();
  const gateStatusCountsMap = new Map<string, number>();
  const departmentCoverageMap = new Map<string, number>();
  const microsoftByType = makeEmptyMicrosoftSummary().byType;

  let projectsWithClientLink = 0;
  let projectsWithLatestUpdate = 0;
  let projectsUpdatedInLast7Days = 0;
  let executionEnabledCount = 0;
  let microsoftLinkedProjects = 0;
  let totalMicrosoftLinkedItems = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const project of projects) {
    const stageLabel = project.lifecycleStageLabel || "Unassigned";
    stageDistributionMap.set(stageLabel, (stageDistributionMap.get(stageLabel) || 0) + 1);

    const gateStatus = project.stageGate.executionGateStatus || "UNKNOWN";
    gateStatusCountsMap.set(gateStatus, (gateStatusCountsMap.get(gateStatus) || 0) + 1);

    if (project.clientId) projectsWithClientLink += 1;
    if (project.latestUpdate.text) projectsWithLatestUpdate += 1;
    if (project.latestUpdate.updatedAt && timestampOf(project.latestUpdate.updatedAt) >= sevenDaysAgo) {
      projectsUpdatedInLast7Days += 1;
    }
    if (project.stageGate.executionEnabled) executionEnabledCount += 1;

    if (project.microsoft.totalLinkedItems > 0) {
      microsoftLinkedProjects += 1;
      totalMicrosoftLinkedItems += project.microsoft.totalLinkedItems;
      for (const [type, count] of Object.entries(project.microsoft.byType) as Array<[MicrosoftTypeKey, number]>) {
        microsoftByType[type] += count;
      }
    }

    for (const department of project.departments) {
      departmentCoverageMap.set(department, (departmentCoverageMap.get(department) || 0) + 1);
    }
  }

  const clientOverview: ProjectLifecycleWorkspaceClient[] = clientRows.map((clientRow) => {
    const clientProjects = projects.filter((project) => project.clientId === clientRow.id);
    const latestProject = [...clientProjects].sort(
      (left, right) => timestampOf(right.latestUpdate.updatedAt) - timestampOf(left.latestUpdate.updatedAt),
    )[0];
    const departmentCoverage = Array.from(
      new Set(clientProjects.flatMap((project) => project.departments)),
    ).sort();

    const lifecycleDistributionMap = new Map<string, number>();
    const lifecycleStages = new Set<string>();
    const latestUpdates: ProjectLifecycleWorkspaceClientUpdate[] = [];
    const linkedProjects: ProjectLifecycleWorkspaceClientLinkedProject[] = [];
    const signals = buildEmptyClientSignals();
    const microsoft = {
      totalLinkedItems: 0,
      linkedProjectCount: 0,
      latestActivityAt: null,
      byType: makeEmptyMicrosoftSummary().byType,
    };

    for (const project of clientProjects) {
      const stageLabel = project.lifecycleStageLabel || "Unassigned";
      lifecycleDistributionMap.set(stageLabel, (lifecycleDistributionMap.get(stageLabel) || 0) + 1);
      lifecycleStages.add(stageLabel);

      signals.financial.totalRevenue += project.metrics.totalRevenue;
      signals.financial.totalCost += project.metrics.totalCost;
      if (project.metrics.totalRevenue > 0 || project.metrics.totalCost > 0) {
        signals.financial.projectsWithFinancialData += 1;
      }

      signals.quality.pendingApprovals += project.workflow.approvals.pending;
      signals.quality.inReviewDeliverables += project.workflow.deliverables.inReview;
      signals.quality.completedDeliverables += project.workflow.deliverables.completed;

      if (isBlockedByStageGate(project)) signals.risk.blockedProjects += 1;
      if (!project.latestUpdate.text) signals.risk.projectsMissingLatestUpdate += 1;
      signals.risk.overdueWorkItems += project.metrics.overdueWorkItems;
      if (isEscalated(project.escalationLevel)) signals.risk.escalatedProjects += 1;
      if ((project.ragStatus || "").toUpperCase() === "RED") signals.risk.ragRedProjects += 1;
      if ((project.ragStatus || "").toUpperCase() === "AMBER") signals.risk.ragAmberProjects += 1;

      microsoft.totalLinkedItems += project.microsoft.totalLinkedItems;
      if (project.microsoft.totalLinkedItems > 0) {
        microsoft.linkedProjectCount += 1;
      }
      if (timestampOf(project.microsoft.latestLinkedAt) > timestampOf(microsoft.latestActivityAt)) {
        microsoft.latestActivityAt = project.microsoft.latestLinkedAt;
      }
      for (const [type, count] of Object.entries(project.microsoft.byType) as Array<[MicrosoftTypeKey, number]>) {
        microsoft.byType[type] += count;
      }

      if (project.latestUpdate.text && project.latestUpdate.updatedAt) {
        latestUpdates.push({
          projectInfoId: project.projectInfoId,
          projectName: project.projectName,
          lifecycleStageLabel: project.lifecycleStageLabel,
          text: project.latestUpdate.text,
          updatedAt: project.latestUpdate.updatedAt,
          updatedBy: project.latestUpdate.updatedBy,
          ragStatus: project.ragStatus,
          microsoftLinkedItems: project.microsoft.totalLinkedItems,
        });
      }

      linkedProjects.push({
        projectInfoId: project.projectInfoId,
        projectName: project.projectName,
        lifecycleStageLabel: project.lifecycleStageLabel,
        isActive: project.isActive,
        executionGateStatus: project.stageGate.executionGateStatus,
        executionEnabled: project.stageGate.executionEnabled,
        latestUpdateText: project.latestUpdate.text,
        latestUpdateAt: project.latestUpdate.updatedAt,
        latestUpdateBy: project.latestUpdate.updatedBy,
        totalRevenue: project.metrics.totalRevenue,
        totalCost: project.metrics.totalCost,
        pendingApprovals: project.workflow.approvals.pending,
        inReviewDeliverables: project.workflow.deliverables.inReview,
        completedDeliverables: project.workflow.deliverables.completed,
        overdueWorkItems: project.metrics.overdueWorkItems,
        microsoftLinkedItems: project.microsoft.totalLinkedItems,
        ragStatus: project.ragStatus,
        escalationLevel: project.escalationLevel,
      });
    }

    signals.financial.grossMargin = signals.financial.totalRevenue - signals.financial.totalCost;

    latestUpdates.sort((left, right) => timestampOf(right.updatedAt) - timestampOf(left.updatedAt));
    linkedProjects.sort((left, right) => {
      const activeDelta = Number(right.isActive) - Number(left.isActive);
      if (activeDelta !== 0) return activeDelta;
      const updateDelta = timestampOf(right.latestUpdateAt) - timestampOf(left.latestUpdateAt);
      if (updateDelta !== 0) return updateDelta;
      return left.projectName.localeCompare(right.projectName);
    });

    return {
      clientId: clientRow.id,
      clientCode: clientRow.clientId,
      clientName: clientRow.name,
      projectCount: clientProjects.length,
      activeProjectCount: clientProjects.filter((project) => project.isActive).length,
      lifecycleStages: Array.from(lifecycleStages).sort(),
      lifecycleDistribution: Array.from(lifecycleDistributionMap.entries())
        .map(([stage, count]) => ({ stage, count }))
        .sort((left, right) => right.count - left.count || left.stage.localeCompare(right.stage)),
      departmentCoverage,
      latestUpdateAt: latestProject?.latestUpdate.updatedAt || null,
      latestUpdateProjectName: latestProject?.projectName || null,
      microsoftLinkedItems: microsoft.totalLinkedItems,
      latestUpdates: latestUpdates.slice(0, 6),
      linkedProjects,
      signals,
      microsoft,
    };
  });

  clientOverview.sort((left, right) => {
    const projectDelta = right.projectCount - left.projectCount;
    if (projectDelta !== 0) return projectDelta;
    return left.clientName.localeCompare(right.clientName);
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalProjects: projects.length,
      activeProjects: projects.filter((project) => project.isActive).length,
      projectsWithClientLink,
      projectsWithLatestUpdate,
      projectsMissingLatestUpdate: projects.length - projectsWithLatestUpdate,
      projectsUpdatedInLast7Days,
      stageDistribution: Array.from(stageDistributionMap.entries())
        .map(([stage, count]) => ({ stage, count }))
        .sort((left, right) => right.count - left.count || left.stage.localeCompare(right.stage)),
      gateStatusCounts: Array.from(gateStatusCountsMap.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status)),
      executionEnabledCount,
      microsoftLinkedProjects,
      totalMicrosoftLinkedItems,
      microsoftByType,
      departmentCoverage: Array.from(departmentCoverageMap.entries())
        .map(([department, count]) => ({ department, count }))
        .sort((left, right) => right.count - left.count || left.department.localeCompare(right.department)),
      totalClients: clientOverview.length,
      clientsWithProjects: clientOverview.filter((client) => client.projectCount > 0).length,
    },
    projects,
    clients: clientOverview,
  };
}

export async function buildProjectLifecycleWorkspace(): Promise<ProjectLifecycleWorkspacePayload> {
  const [projectRows, phaseHistoryRows, microsoftRows, clientRows, summaryMap] = await Promise.all([
    db
      .select({
        id: projectInfo.id,
        canonicalProjectId: projectInfo.canonicalProjectId,
        projectName: projectInfo.projectName,
        clientId: projectInfo.clientId,
        phase: projectInfo.phase,
        executionPhase: projectInfo.executionPhase,
        pm: projectInfo.pm,
        pd: projectInfo.pd,
        isActive: projectInfo.isActive,
        archivedStatus: projectInfo.archivedStatus,
        phaseUpdatedAt: projectInfo.phaseUpdatedAt,
        executionGateStatus: projectInfo.executionGateStatus,
        executionEnabled: projectInfo.executionEnabled,
        signedStatus: projectInfo.signedStatus,
        signedDate: projectInfo.signedDate,
        ragStatus: projectInfo.ragStatus,
        escalationLevel: projectInfo.escalationLevel,
      })
      .from(projectInfo)
      .orderBy(projectInfo.projectName),
    db
      .select({
        projectId: projectPhaseHistory.projectId,
        changedAt: projectPhaseHistory.changedAt,
      })
      .from(projectPhaseHistory)
      .orderBy(desc(projectPhaseHistory.changedAt)),
    db
      .select({
        projectId: msObjects.linkedProjectId,
        type: msObjects.type,
        linkedAt: msObjects.receivedOrStartDatetime,
      })
      .from(msObjects)
      .where(sql`${msObjects.linkedProjectId} is not null`)
      .orderBy(desc(msObjects.receivedOrStartDatetime)),
    db
      .select({
        id: clients.id,
        clientId: clients.clientId,
        name: clients.name,
      })
      .from(clients)
      .orderBy(clients.name),
    getPlatformProjectSummaryMap(),
  ]);

  return buildProjectLifecycleWorkspaceFromSources({
    projectRows,
    phaseHistoryRows,
    microsoftRows,
    clientRows,
    summaryMap,
  });
}
