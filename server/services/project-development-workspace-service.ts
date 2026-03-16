import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PlatformProjectSummaryContract } from "@shared/platform-contracts";
import {
  intakeRequests,
  intakeTasks,
  msObjects,
  operationalTasks,
  pdTickets,
  projectCommunicationTimelineEvents,
  projectEditableFields,
  projectPhaseHistory,
  raidItems,
  workItemDependencies,
  workItems,
} from "@shared/schema";
import { db } from "../db";
import { getPlatformProjectSummaryMap } from "./project-platform-summary-service";

export const FEASIBILITY_STATUS_VALUES = [
  "NOT_ASSESSED",
  "UNDER_REVIEW",
  "FEASIBLE",
  "CONDITIONAL",
  "NOT_FEASIBLE",
] as const;

export const HANDOVER_READINESS_STATUS_VALUES = [
  "NOT_READY",
  "READY_WITH_ACTIONS",
  "READY_FOR_HANDOVER",
] as const;

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCompletedStatus(value: unknown): boolean {
  return ["completed", "complete", "closed", "resolved", "done"].includes(String(value ?? "").trim().toLowerCase());
}

function requiresQualityStatus(engineeringStatus: string): boolean {
  const normalized = engineeringStatus.trim().toLowerCase();
  if (!normalized) return true;
  return ["na", "n/a", "not applicable", "not started"].every((token) => !normalized.includes(token));
}

function normalizeDeliverables(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
}

function countCompletedDeliverables(value: unknown): number {
  const deliverables = normalizeDeliverables(value);
  return ["handoverCharter", "siteVisitReport", "signedCostProposal"].filter((key) => {
    const item = deliverables[key];
    return !!textOrNull(item?.reference);
  }).length;
}

function getKpiValue(summary: PlatformProjectSummaryContract | undefined, kpiId: string): number {
  return summary?.kpis.find((kpi) => kpi.id === kpiId)?.value ?? 0;
}

type IntakeRequestSource = {
  id: number;
  requestType: string | null;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  appNotes: string | null;
  appInternalBlockers: string | null;
  syncConflict: boolean | null;
  cpSigned: boolean;
  pmCreated: boolean;
  tasksGenerated: boolean;
  updatedAt: unknown;
};

type IntakeTaskSource = {
  id: number;
  intakeRequestId: number;
  status: string | null;
};

type PdTicketSource = {
  id: number;
  requestType: string;
  status: string;
  dueDate: string | null;
  numberOfReworks: number;
  developerName: string | null;
  designerName: string | null;
};

type PdTicketTaskSource = {
  pdTicketId: number | null;
  total: number;
  completed: number;
};

type WorkItemSource = {
  id: number;
  title: string;
  status: string | null;
  workstream: string;
};

type WorkItemDependencySource = {
  id: number;
  predecessorId: number;
  successorId: number;
  depType: string;
  lagDays: number | null;
};

type RaidSource = {
  id: number;
  type: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  mitigationResponse: string | null;
  updatedAt: unknown;
};

type MicrosoftSource = {
  id: number;
  type: string;
  subjectOrTitle: string | null;
  senderOrOrganizer: string | null;
  receivedOrStartDatetime: unknown;
  webLink: string | null;
  actionRequired: boolean | null;
};

type CommunicationTimelineSource = {
  id: number;
  eventType: string;
  eventTitle: string;
  eventDetail: string | null;
  createdAt: unknown;
};

type PhaseHistorySource = {
  id?: number;
  projectId: number;
  changedAt: unknown;
  fromPhase?: string | null;
  toPhase?: string | null;
  reason?: string | null;
};

export interface ProjectDevelopmentWorkspacePayload {
  spine: {
    projectInfoId: number;
    canonicalProjectId: number | null;
    clientId: number | null;
    phase: string | null;
    executionGateStatus: string | null;
    executionEnabled: boolean;
    phaseHistoryCount: number;
    latestPhaseChangeAt: string | null;
  };
  latestUpdate: {
    text: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    isPresent: boolean;
  };
  intake: {
    totalRequests: number;
    openRequests: number;
    completedRequests: number;
    pendingTaskCount: number;
    completedTaskCount: number;
    hasSyncConflict: boolean;
    hasInternalBlockers: boolean;
    cpSignedCount: number;
    pmCreatedCount: number;
    tasksGeneratedCount: number;
    requests: Array<{
      id: number;
      requestType: string | null;
      status: string | null;
      priority: string | null;
      dueDate: string | null;
      appNotes: string | null;
      appInternalBlockers: string | null;
      syncConflict: boolean;
      cpSigned: boolean;
      pmCreated: boolean;
      tasksGenerated: boolean;
      pendingTasks: number;
      completedTasks: number;
      updatedAt: string | null;
    }>;
  };
  pdTickets: {
    total: number;
    open: number;
    completed: number;
    tickets: Array<{
      id: number;
      requestType: string;
      status: string;
      dueDate: string | null;
      numberOfReworks: number;
      developerName: string | null;
      designerName: string | null;
      taskTotal: number;
      taskCompleted: number;
    }>;
  };
  dependencies: {
    total: number;
    openWorkItems: number;
    blockedWorkItems: number;
    derivedSummary: string | null;
    items: Array<{
      id: number;
      predecessorId: number;
      predecessorTitle: string;
      predecessorStatus: string | null;
      successorId: number;
      successorTitle: string;
      successorStatus: string | null;
      depType: string;
      lagDays: number;
    }>;
  };
  risks: {
    total: number;
    open: number;
    critical: number;
    byType: Record<string, number>;
    items: Array<{
      id: number;
      type: string;
      title: string;
      status: string;
      priority: string;
      dueDate: string | null;
      mitigationResponse: string | null;
      updatedAt: string | null;
    }>;
  };
  microsoft: {
    totalLinkedItems: number;
    actionRequiredCount: number;
    latestLinkedAt: string | null;
    byType: Record<string, number>;
    recentItems: Array<{
      id: number;
      type: string;
      subjectOrTitle: string | null;
      senderOrOrganizer: string | null;
      receivedOrStartDatetime: string | null;
      webLink: string | null;
      actionRequired: boolean;
    }>;
    timelineEvents: Array<{
      id: number;
      eventType: string;
      eventTitle: string;
      eventDetail: string | null;
      createdAt: string | null;
    }>;
  };
  readiness: {
    feasibilityStatus: string | null;
    feasibilityNotes: string | null;
    dependencySummary: string | null;
    readinessStatus: string | null;
    readinessNotes: string | null;
    hasLatestUpdate: boolean;
    unresolvedIntakeTasks: boolean;
    unresolvedIntakeBlockers: boolean;
    minimumInputsReady: boolean;
  };
  downstream: {
    engineering: {
      status: string | null;
      openDependencies: number;
      openRisks: number;
      activeWorkItems: number;
      pendingApprovals: number;
    };
    projectManagement: {
      pmOwner: string | null;
      deliverablesComplete: number;
      readinessStatus: string | null;
      latestUpdateAt: string | null;
      summary: string | null;
    };
    finance: {
      signedCostProposal: boolean;
      totalRevenue: number;
      totalCost: number;
      latestUpdateText: string | null;
    };
    quality: {
      qualityStatus: string | null;
      qualityRequired: boolean;
      openRisks: number;
      inReviewDeliverables: number;
      completedDeliverables: number;
    };
  };
}

export function buildProjectDevelopmentWorkspaceFromSources(params: {
  project: {
    id: number;
    canonicalProjectId: number | null;
    clientId: number | null;
    phase: string | null;
    executionGateStatus: string | null;
    executionEnabled: boolean;
  };
  handover: any | null;
  latestUpdate?: {
    text: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  } | null;
  intakeRequestRows: IntakeRequestSource[];
  intakeTaskRows: IntakeTaskSource[];
  pdTicketRows: PdTicketSource[];
  pdTicketTaskRows: PdTicketTaskSource[];
  workItemRows: WorkItemSource[];
  workItemDependencyRows: WorkItemDependencySource[];
  raidRows: RaidSource[];
  microsoftRows: MicrosoftSource[];
  communicationTimelineRows: CommunicationTimelineSource[];
  phaseHistoryRows: PhaseHistorySource[];
  platformSummary?: PlatformProjectSummaryContract;
}): ProjectDevelopmentWorkspacePayload {
  const deliverables = normalizeDeliverables(params.handover?.deliverables);
  const latestUpdateText = textOrNull(params.latestUpdate?.text);
  const latestUpdateAt = textOrNull(params.latestUpdate?.updatedAt);
  const latestUpdateBy = textOrNull(params.latestUpdate?.updatedBy);

  const intakeTaskCounts = new Map<number, { total: number; completed: number }>();
  for (const task of params.intakeTaskRows) {
    const entry = intakeTaskCounts.get(task.intakeRequestId) || { total: 0, completed: 0 };
    entry.total += 1;
    if (isCompletedStatus(task.status)) entry.completed += 1;
    intakeTaskCounts.set(task.intakeRequestId, entry);
  }

  const intakeRequestsSummary = params.intakeRequestRows.map((row) => {
    const counts = intakeTaskCounts.get(row.id) || { total: 0, completed: 0 };
    return {
      id: row.id,
      requestType: textOrNull(row.requestType),
      status: textOrNull(row.status),
      priority: textOrNull(row.priority),
      dueDate: textOrNull(row.dueDate),
      appNotes: textOrNull(row.appNotes),
      appInternalBlockers: textOrNull(row.appInternalBlockers),
      syncConflict: row.syncConflict === true,
      cpSigned: row.cpSigned === true,
      pmCreated: row.pmCreated === true,
      tasksGenerated: row.tasksGenerated === true,
      pendingTasks: Math.max(0, counts.total - counts.completed),
      completedTasks: counts.completed,
      updatedAt: toIsoString(row.updatedAt),
    };
  });

  const pdTicketTaskCounts = new Map<number, { total: number; completed: number }>();
  for (const row of params.pdTicketTaskRows) {
    if (!row.pdTicketId) continue;
    pdTicketTaskCounts.set(row.pdTicketId, { total: toNumber(row.total), completed: toNumber(row.completed) });
  }

  const pdTicketSummary = params.pdTicketRows.map((row) => {
    const counts = pdTicketTaskCounts.get(row.id) || { total: 0, completed: 0 };
    return {
      id: row.id,
      requestType: row.requestType,
      status: row.status,
      dueDate: textOrNull(row.dueDate),
      numberOfReworks: toNumber(row.numberOfReworks),
      developerName: textOrNull(row.developerName),
      designerName: textOrNull(row.designerName),
      taskTotal: counts.total,
      taskCompleted: counts.completed,
    };
  });

  const workItemMap = new Map<number, WorkItemSource>();
  for (const row of params.workItemRows) {
    workItemMap.set(row.id, row);
  }

  const dependencyItems = params.workItemDependencyRows
    .map((row) => {
      const predecessor = workItemMap.get(row.predecessorId);
      const successor = workItemMap.get(row.successorId);
      if (!predecessor || !successor) return null;
      return {
        id: row.id,
        predecessorId: row.predecessorId,
        predecessorTitle: predecessor.title,
        predecessorStatus: textOrNull(predecessor.status),
        successorId: row.successorId,
        successorTitle: successor.title,
        successorStatus: textOrNull(successor.status),
        depType: row.depType,
        lagDays: toNumber(row.lagDays),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const blockedSuccessorIds = new Set<number>();
  for (const item of dependencyItems) {
    if (!isCompletedStatus(item.successorStatus)) {
      blockedSuccessorIds.add(item.successorId);
    }
  }
  const openWorkItems = params.workItemRows.filter((row) => !isCompletedStatus(row.status)).length;

  const riskByType: Record<string, number> = {};
  for (const row of params.raidRows) {
    const key = textOrNull(row.type) || "other";
    riskByType[key] = (riskByType[key] || 0) + 1;
  }
  const openRiskItems = params.raidRows.filter((row) => !isCompletedStatus(row.status));
  const criticalRiskItems = openRiskItems.filter((row) => String(row.priority || "").trim().toLowerCase() === "critical");

  const microsoftByType: Record<string, number> = {};
  for (const row of params.microsoftRows) {
    const key = textOrNull(row.type) || "other";
    microsoftByType[key] = (microsoftByType[key] || 0) + 1;
  }

  const intakePendingTaskCount = intakeRequestsSummary.reduce((sum, row) => sum + row.pendingTasks, 0);
  const intakeCompletedTaskCount = intakeRequestsSummary.reduce((sum, row) => sum + row.completedTasks, 0);
  const intakeHasSyncConflict = intakeRequestsSummary.some((row) => row.syncConflict);
  const intakeHasInternalBlockers = intakeRequestsSummary.some((row) => !!row.appInternalBlockers);

  const dependencyDerivedSummary = dependencyItems.length > 0
    ? `${blockedSuccessorIds.size} blocked work item${blockedSuccessorIds.size === 1 ? "" : "s"} across ${dependencyItems.length} mapped dependenc${dependencyItems.length === 1 ? "y" : "ies"}`
    : null;

  const feasibilityStatus = textOrNull(params.handover?.feasibility_status);
  const feasibilityNotes = textOrNull(params.handover?.feasibility_notes);
  const dependencySummary = textOrNull(params.handover?.dependency_summary);
  const readinessStatus = textOrNull(params.handover?.handover_readiness_status);
  const readinessNotes = textOrNull(params.handover?.handover_readiness_notes);
  const engineeringStatus = textOrNull(params.handover?.engineering_status) || "";
  const qualityStatus = textOrNull(params.handover?.quality_status);

  const platformSummary = params.platformSummary;
  const deliverablesComplete = countCompletedDeliverables(deliverables);

  return {
    spine: {
      projectInfoId: params.project.id,
      canonicalProjectId: params.project.canonicalProjectId ?? null,
      clientId: params.project.clientId ?? null,
      phase: textOrNull(params.project.phase),
      executionGateStatus: textOrNull(params.project.executionGateStatus),
      executionEnabled: params.project.executionEnabled === true,
      phaseHistoryCount: params.phaseHistoryRows.length,
      latestPhaseChangeAt: params.phaseHistoryRows.length > 0 ? toIsoString(params.phaseHistoryRows[0].changedAt) : null,
    },
    latestUpdate: {
      text: latestUpdateText,
      updatedAt: latestUpdateAt,
      updatedBy: latestUpdateBy,
      isPresent: !!latestUpdateText,
    },
    intake: {
      totalRequests: intakeRequestsSummary.length,
      openRequests: intakeRequestsSummary.filter((row) => !isCompletedStatus(row.status)).length,
      completedRequests: intakeRequestsSummary.filter((row) => isCompletedStatus(row.status)).length,
      pendingTaskCount: intakePendingTaskCount,
      completedTaskCount: intakeCompletedTaskCount,
      hasSyncConflict: intakeHasSyncConflict,
      hasInternalBlockers: intakeHasInternalBlockers,
      cpSignedCount: intakeRequestsSummary.filter((row) => row.cpSigned).length,
      pmCreatedCount: intakeRequestsSummary.filter((row) => row.pmCreated).length,
      tasksGeneratedCount: intakeRequestsSummary.filter((row) => row.tasksGenerated).length,
      requests: intakeRequestsSummary,
    },
    pdTickets: {
      total: pdTicketSummary.length,
      open: pdTicketSummary.filter((row) => !isCompletedStatus(row.status)).length,
      completed: pdTicketSummary.filter((row) => isCompletedStatus(row.status)).length,
      tickets: pdTicketSummary,
    },
    dependencies: {
      total: dependencyItems.length,
      openWorkItems,
      blockedWorkItems: blockedSuccessorIds.size,
      derivedSummary: dependencyDerivedSummary,
      items: dependencyItems,
    },
    risks: {
      total: params.raidRows.length,
      open: openRiskItems.length,
      critical: criticalRiskItems.length,
      byType: riskByType,
      items: openRiskItems.slice(0, 8).map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueDate: textOrNull(row.dueDate),
        mitigationResponse: textOrNull(row.mitigationResponse),
        updatedAt: toIsoString(row.updatedAt),
      })),
    },
    microsoft: {
      totalLinkedItems: params.microsoftRows.length,
      actionRequiredCount: params.microsoftRows.filter((row) => row.actionRequired === true).length,
      latestLinkedAt: params.microsoftRows.length > 0 ? toIsoString(params.microsoftRows[0].receivedOrStartDatetime) : null,
      byType: microsoftByType,
      recentItems: params.microsoftRows.slice(0, 8).map((row) => ({
        id: row.id,
        type: row.type,
        subjectOrTitle: textOrNull(row.subjectOrTitle),
        senderOrOrganizer: textOrNull(row.senderOrOrganizer),
        receivedOrStartDatetime: toIsoString(row.receivedOrStartDatetime),
        webLink: textOrNull(row.webLink),
        actionRequired: row.actionRequired === true,
      })),
      timelineEvents: params.communicationTimelineRows.slice(0, 8).map((row) => ({
        id: row.id,
        eventType: row.eventType,
        eventTitle: row.eventTitle,
        eventDetail: textOrNull(row.eventDetail),
        createdAt: toIsoString(row.createdAt),
      })),
    },
    readiness: {
      feasibilityStatus,
      feasibilityNotes,
      dependencySummary,
      readinessStatus,
      readinessNotes,
      hasLatestUpdate: !!latestUpdateText,
      unresolvedIntakeTasks: intakePendingTaskCount > 0,
      unresolvedIntakeBlockers: intakeHasSyncConflict || intakeHasInternalBlockers,
      minimumInputsReady:
        !!latestUpdateText &&
        !!feasibilityStatus &&
        !!feasibilityNotes &&
        !!dependencySummary &&
        readinessStatus === "READY_FOR_HANDOVER" &&
        !!readinessNotes &&
        !intakeHasSyncConflict &&
        !intakeHasInternalBlockers &&
        intakePendingTaskCount === 0,
    },
    downstream: {
      engineering: {
        status: textOrNull(params.handover?.engineering_status),
        openDependencies: blockedSuccessorIds.size,
        openRisks: openRiskItems.length,
        activeWorkItems: getKpiValue(platformSummary, "tasks_active"),
        pendingApprovals: platformSummary?.workflow.approvals.pending ?? 0,
      },
      projectManagement: {
        pmOwner: textOrNull(params.handover?.pm_owner),
        deliverablesComplete,
        readinessStatus,
        latestUpdateAt,
        summary: textOrNull(params.handover?.summary),
      },
      finance: {
        signedCostProposal:
          deliverablesComplete > 0 && !!textOrNull(deliverables.signedCostProposal?.reference) ||
          intakeRequestsSummary.some((row) => row.cpSigned),
        totalRevenue: getKpiValue(platformSummary, "finance_total_revenue"),
        totalCost: getKpiValue(platformSummary, "finance_total_cost"),
        latestUpdateText,
      },
      quality: {
        qualityStatus,
        qualityRequired: requiresQualityStatus(engineeringStatus),
        openRisks: openRiskItems.length,
        inReviewDeliverables: platformSummary?.workflow.deliverables.inReview ?? 0,
        completedDeliverables: platformSummary?.workflow.deliverables.completed ?? 0,
      },
    },
  };
}

export function computePdPmSubmitBlockers(params: {
  project: {
    pm?: string | null;
    pd?: string | null;
    clientId?: number | null;
  };
  handover: any;
  workspace: ProjectDevelopmentWorkspacePayload;
}): string[] {
  const deliverables = normalizeDeliverables(params.handover?.deliverables);
  const engineeringStatus = String(params.handover?.engineering_status || "").trim();
  const qualityStatus = String(params.handover?.quality_status || "").trim();
  const feasibilityStatus = String(params.handover?.feasibility_status || "").trim();
  const readinessStatus = String(params.handover?.handover_readiness_status || "").trim();

  const missingItems: string[] = [];
  const need = (ok: boolean, label: string) => {
    if (!ok) missingItems.push(label);
  };

  need(!!textOrNull(deliverables?.handoverCharter?.reference), "Handover Charter");
  need(!!textOrNull(deliverables?.siteVisitReport?.reference), "Site Visit Report");
  need(!!textOrNull(deliverables?.signedCostProposal?.reference), "Signed Cost Proposal");
  need(!!textOrNull(params.project.pm), "PM assignment");
  need(!!textOrNull(params.handover?.summary), "Scope summary");
  need(!!params.project.clientId, "Linked master project/client");
  need(!!textOrNull(params.handover?.pd_owner || params.project.pd), "PD owner");
  need(!!engineeringStatus, "Engineering status");
  need(!!textOrNull(params.handover?.risks), "Risk summary");
  need(!!textOrNull(params.handover?.assumptions), "Assumptions");
  need(!!feasibilityStatus && feasibilityStatus !== "NOT_ASSESSED", "Feasibility status");
  need(!!textOrNull(params.handover?.feasibility_notes), "Feasibility notes");
  need(!!textOrNull(params.handover?.dependency_summary), "Dependency summary");
  need(readinessStatus === "READY_FOR_HANDOVER", "Readiness status set to Ready for handover");
  need(!!textOrNull(params.handover?.handover_readiness_notes), "Handover readiness notes");
  need(params.workspace.latestUpdate.isPresent, "Canonical latest update");

  if (requiresQualityStatus(engineeringStatus)) {
    need(!!qualityStatus, "Quality status");
  }
  if (params.workspace.intake.hasSyncConflict) {
    missingItems.push("Resolve intake sync conflicts");
  }
  if (params.workspace.intake.hasInternalBlockers) {
    missingItems.push("Clear intake internal blockers");
  }
  if (params.workspace.intake.pendingTaskCount > 0) {
    missingItems.push("Complete linked intake tasks");
  }

  return missingItems;
}

export async function getProjectDevelopmentWorkspace(params: {
  projectId: number;
  projectName: string;
  canonicalProjectId?: number | null;
  clientId?: number | null;
  phase?: string | null;
  executionGateStatus?: string | null;
  executionEnabled?: boolean;
  handover: any | null;
}): Promise<ProjectDevelopmentWorkspacePayload> {
  const [editableRows, intakeRows, pdTicketRows, raidRows, microsoftRows, communicationTimelineRows, phaseHistoryRows, workItemRows, summaryMap] = await Promise.all([
    db
      .select({
        latestUpdate: projectEditableFields.latestUpdate,
        latestUpdateAt: projectEditableFields.latestUpdateAt,
        latestUpdateBy: projectEditableFields.latestUpdateBy,
      })
      .from(projectEditableFields)
      .where(eq(projectEditableFields.projectName, params.projectName))
      .limit(1),
    db
      .select({
        id: intakeRequests.id,
        requestType: intakeRequests.requestType,
        status: intakeRequests.status,
        priority: intakeRequests.priority,
        dueDate: intakeRequests.dueDate,
        appNotes: intakeRequests.appNotes,
        appInternalBlockers: intakeRequests.appInternalBlockers,
        syncConflict: intakeRequests.syncConflict,
        cpSigned: intakeRequests.cpSigned,
        pmCreated: intakeRequests.pmCreated,
        tasksGenerated: intakeRequests.tasksGenerated,
        updatedAt: intakeRequests.updatedAt,
      })
      .from(intakeRequests)
      .where(eq(intakeRequests.projectId, params.projectId))
      .orderBy(desc(intakeRequests.updatedAt)),
    db
      .select({
        id: pdTickets.id,
        requestType: pdTickets.requestType,
        status: pdTickets.status,
        dueDate: pdTickets.dueDate,
        numberOfReworks: pdTickets.numberOfReworks,
        developerName: sql<string>`(SELECT name FROM users WHERE id = ${pdTickets.projectDeveloperUserId})`,
        designerName: sql<string>`(SELECT name FROM users WHERE id = ${pdTickets.designerUserId})`,
      })
      .from(pdTickets)
      .where(eq(pdTickets.projectId, params.projectId))
      .orderBy(desc(pdTickets.updatedAt)),
    db.select().from(raidItems).where(eq(raidItems.projectId, params.projectId)).orderBy(desc(raidItems.updatedAt)),
    db
      .select({
        id: msObjects.id,
        type: msObjects.type,
        subjectOrTitle: msObjects.subjectOrTitle,
        senderOrOrganizer: msObjects.senderOrOrganizer,
        receivedOrStartDatetime: msObjects.receivedOrStartDatetime,
        webLink: msObjects.webLink,
        actionRequired: msObjects.actionRequired,
      })
      .from(msObjects)
      .where(eq(msObjects.linkedProjectId, params.projectId))
      .orderBy(desc(msObjects.receivedOrStartDatetime)),
    db
      .select({
        id: projectCommunicationTimelineEvents.id,
        eventType: projectCommunicationTimelineEvents.eventType,
        eventTitle: projectCommunicationTimelineEvents.eventTitle,
        eventDetail: projectCommunicationTimelineEvents.eventDetail,
        createdAt: projectCommunicationTimelineEvents.createdAt,
      })
      .from(projectCommunicationTimelineEvents)
      .where(eq(projectCommunicationTimelineEvents.projectId, params.projectId))
      .orderBy(desc(projectCommunicationTimelineEvents.createdAt)),
    db
      .select({
        projectId: projectPhaseHistory.projectId,
        changedAt: projectPhaseHistory.changedAt,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        reason: projectPhaseHistory.reason,
      })
      .from(projectPhaseHistory)
      .where(eq(projectPhaseHistory.projectId, params.projectId))
      .orderBy(desc(projectPhaseHistory.changedAt)),
    db
      .select({
        id: workItems.id,
        title: workItems.title,
        status: workItems.status,
        workstream: workItems.workstream,
      })
      .from(workItems)
      .where(and(eq(workItems.projectId, params.projectId), isNull(workItems.deletedAt))),
    getPlatformProjectSummaryMap({ projectIds: [params.projectId] }),
  ]);

  const intakeRequestIds = intakeRows.map((row) => row.id);
  const pdTicketIds = pdTicketRows.map((row) => row.id);
  const workItemIds = workItemRows.map((row) => row.id);

  const [intakeTaskRows, pdTicketTaskRows, workItemDependencyRows] = await Promise.all([
    intakeRequestIds.length > 0
      ? db
          .select({
            id: intakeTasks.id,
            intakeRequestId: intakeTasks.intakeRequestId,
            status: intakeTasks.status,
          })
          .from(intakeTasks)
          .where(inArray(intakeTasks.intakeRequestId, intakeRequestIds))
      : Promise.resolve([]),
    pdTicketIds.length > 0
      ? db
          .select({
            pdTicketId: operationalTasks.pdTicketId,
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) filter (where ${operationalTasks.status} = 'COMPLETE')::int`,
          })
          .from(operationalTasks)
          .where(inArray(operationalTasks.pdTicketId, pdTicketIds))
          .groupBy(operationalTasks.pdTicketId)
      : Promise.resolve([]),
    workItemIds.length > 0
      ? db
          .select({
            id: workItemDependencies.id,
            predecessorId: workItemDependencies.predecessorId,
            successorId: workItemDependencies.successorId,
            depType: workItemDependencies.depType,
            lagDays: workItemDependencies.lagDays,
          })
          .from(workItemDependencies)
          .where(
            or(
              inArray(workItemDependencies.predecessorId, workItemIds),
              inArray(workItemDependencies.successorId, workItemIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  return buildProjectDevelopmentWorkspaceFromSources({
    project: {
      id: params.projectId,
      canonicalProjectId: params.canonicalProjectId ?? null,
      clientId: params.clientId ?? null,
      phase: params.phase ?? null,
      executionGateStatus: params.executionGateStatus ?? null,
      executionEnabled: params.executionEnabled === true,
    },
    handover: params.handover,
    latestUpdate: editableRows[0]
      ? {
          text: textOrNull(editableRows[0].latestUpdate),
          updatedAt: toIsoString(editableRows[0].latestUpdateAt),
          updatedBy: textOrNull(editableRows[0].latestUpdateBy),
        }
      : null,
    intakeRequestRows: intakeRows,
    intakeTaskRows,
    pdTicketRows,
    pdTicketTaskRows,
    workItemRows,
    workItemDependencyRows,
    raidRows: raidRows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate,
      mitigationResponse: row.mitigationResponse,
      updatedAt: row.updatedAt,
    })),
    microsoftRows,
    communicationTimelineRows,
    phaseHistoryRows,
    platformSummary: summaryMap.get(params.projectId),
  });
}
