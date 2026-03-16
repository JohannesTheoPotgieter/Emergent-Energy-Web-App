export type MicrosoftTypeKey = "email" | "event" | "teams" | "sharepoint_file" | "other";

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
  stageHistory: {
    count: number;
    lastChangedAt: string | null;
  };
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
  microsoft: {
    totalLinkedItems: number;
    byType: Record<MicrosoftTypeKey, number>;
    latestLinkedAt: string | null;
  };
  ragStatus: string | null;
  escalationLevel: string | null;
  metrics: {
    totalRevenue: number;
    totalCost: number;
    activeWorkItems: number;
    overdueWorkItems: number;
  };
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
  latestUpdates: Array<{
    projectInfoId: number;
    projectName: string;
    lifecycleStageLabel: string | null;
    text: string;
    updatedAt: string;
    updatedBy: string | null;
    ragStatus: string | null;
    microsoftLinkedItems: number;
  }>;
  linkedProjects: Array<{
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
  }>;
  signals: {
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
  };
  microsoft: {
    totalLinkedItems: number;
    linkedProjectCount: number;
    latestActivityAt: string | null;
    byType: Record<MicrosoftTypeKey, number>;
  };
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

function toSearchKey(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function filterProjectLifecycleProjects(
  projects: ProjectLifecycleWorkspaceProject[],
  searchTerm: string,
) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return projects;

  return projects.filter((project) => {
    const haystack = [
      project.projectName,
      project.clientName,
      project.lifecycleStageLabel,
      project.rawPhase,
      project.pmName,
      project.pdName,
      project.latestUpdate.text,
      ...project.departments,
    ]
      .map((value) => toSearchKey(value))
      .join(" ");

    return haystack.includes(query);
  });
}

export function filterProjectLifecycleClients(
  clients: ProjectLifecycleWorkspaceClient[],
  searchTerm: string,
) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return clients;

  return clients.filter((client) => {
    const haystack = [
      client.clientCode,
      client.clientName,
      client.latestUpdateProjectName,
      ...client.lifecycleStages,
      ...client.departmentCoverage,
      ...client.latestUpdates.map((update) => update.text),
      ...client.linkedProjects.flatMap((project) => [project.projectName, project.latestUpdateText]),
    ]
      .map((value) => toSearchKey(value))
      .join(" ");

    return haystack.includes(query);
  });
}

export function sortProjectsByLatestUpdate(projects: ProjectLifecycleWorkspaceProject[]) {
  return [...projects].sort((left, right) => {
    const updatedAtDelta = toTimestamp(right.latestUpdate.updatedAt) - toTimestamp(left.latestUpdate.updatedAt);
    if (updatedAtDelta !== 0) return updatedAtDelta;
    return left.projectName.localeCompare(right.projectName);
  });
}

export function getProjectGateVariant(project: ProjectLifecycleWorkspaceProject) {
  if (project.stageGate.executionEnabled) return "enabled";
  if ((project.stageGate.executionGateStatus || "").toUpperCase() === "ELIGIBLE") return "eligible";
  if (project.stageGate.signedStatus && project.stageGate.signedStatus !== "NONE") return "pending";
  return "blocked";
}

export function buildMicrosoftBreakdownItems(byType: Record<MicrosoftTypeKey, number>) {
  return [
    { key: "email", label: "Email", count: byType.email || 0 },
    { key: "event", label: "Meetings", count: byType.event || 0 },
    { key: "teams", label: "Teams", count: byType.teams || 0 },
    { key: "sharepoint_file", label: "Files", count: byType.sharepoint_file || 0 },
    { key: "other", label: "Other", count: byType.other || 0 },
  ].filter((item) => item.count > 0);
}
