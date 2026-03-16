import { desc, sql } from "drizzle-orm";
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
}

export interface ProjectLifecycleWorkspaceClient {
  clientId: number;
  clientCode: string;
  clientName: string;
  projectCount: number;
  activeProjectCount: number;
  lifecycleStages: string[];
  departmentCoverage: string[];
  latestUpdateAt: string | null;
  latestUpdateProjectName: string | null;
  microsoftLinkedItems: number;
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
    if (!existing.latestLinkedAt) {
      existing.latestLinkedAt = toIsoString(row.linkedAt);
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
    const lifecycleStages = Array.from(
      new Set(clientProjects.map((project) => project.lifecycleStageLabel).filter(Boolean) as string[]),
    ).sort();

    return {
      clientId: clientRow.id,
      clientCode: clientRow.clientId,
      clientName: clientRow.name,
      projectCount: clientProjects.length,
      activeProjectCount: clientProjects.filter((project) => project.isActive).length,
      lifecycleStages,
      departmentCoverage,
      latestUpdateAt: latestProject?.latestUpdate.updatedAt || null,
      latestUpdateProjectName: latestProject?.projectName || null,
      microsoftLinkedItems: clientProjects.reduce((sum, project) => sum + project.microsoft.totalLinkedItems, 0),
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
