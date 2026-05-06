import { describe, expect, it } from "vitest";
import type { PlatformProjectSummaryContract } from "../../../shared/platform-contracts";
import { buildProjectLifecycleWorkspaceFromSources } from "../../../server/services/project-lifecycle-workspace-service";

function makeSummary(params: {
  projectInfoId: number;
  canonicalProjectId: number;
  projectName: string;
  clientId: number | null;
  clientName: string | null;
  lifecycleStageLabel: string | null;
  rawPhase: string | null;
  executionPhase: string | null;
  isActive: boolean;
  latestUpdateText: string | null;
  latestUpdateAt: string | null;
  latestUpdateBy: string | null;
  departments: string[];
  pendingApprovals: number;
  approvedApprovals: number;
  inReviewDeliverables: number;
  completedDeliverables: number;
  totalRevenue: number;
  totalCost: number;
  activeTasks: number;
  overdueTasks: number;
}): PlatformProjectSummaryContract {
  return {
    project: {
      canonicalProjectId: params.canonicalProjectId,
      projectInfoId: params.projectInfoId,
      projectName: params.projectName,
      clientId: params.clientId,
      clientName: params.clientName,
      lifecycleStage: params.lifecycleStageLabel,
      lifecycleStageLabel: params.lifecycleStageLabel,
      rawPhase: params.rawPhase,
      executionPhase: params.executionPhase,
      pmUserId: null,
      pdUserId: null,
      pmName: "Pat PM",
      pdName: "Dana PD",
      isActive: params.isActive,
      authoritativeTable: "project_info",
    },
    workspaces: params.departments.map((departmentId) => ({
      departmentId: departmentId as any,
      projectId: params.projectInfoId,
      lifecycleStage: params.lifecycleStageLabel,
      readEntities: ["project_spine"],
      writeEntities: [],
      authoritativeServices: ["project-platform-summary-service"],
    })),
    assignees: [],
    latestUpdate: {
      projectId: params.projectInfoId,
      text: params.latestUpdateText,
      updatedAt: params.latestUpdateAt,
      updatedBy: params.latestUpdateBy,
      sourceTable: "project_editable_fields",
    },
    activity: {
      projectId: params.projectInfoId,
      lastActivityAt: params.latestUpdateAt,
      lastActivitySummary: params.latestUpdateText,
      lastActivityActor: params.latestUpdateBy,
      sourceTable: "project_editable_fields",
    },
    workflow: {
      approvals: {
        total: params.pendingApprovals + params.approvedApprovals,
        pending: params.pendingApprovals,
        approved: params.approvedApprovals,
        rejected: 0,
      },
      deliverables: {
        total: params.inReviewDeliverables + params.completedDeliverables,
        pending: 0,
        inReview: params.inReviewDeliverables,
        completed: params.completedDeliverables,
      },
    },
    kpis: [
      {
        id: "finance_total_revenue",
        name: "Revenue",
        value: params.totalRevenue,
        unit: "currency",
        sourceTable: "finance",
        sourceService: "test",
      },
      {
        id: "finance_total_cost",
        name: "Cost",
        value: params.totalCost,
        unit: "currency",
        sourceTable: "finance",
        sourceService: "test",
      },
      {
        id: "tasks_active",
        name: "Active Tasks",
        value: params.activeTasks,
        unit: "count",
        sourceTable: "work_items",
        sourceService: "test",
      },
      {
        id: "tasks_overdue",
        name: "Overdue Tasks",
        value: params.overdueTasks,
        unit: "count",
        sourceTable: "work_items",
        sourceService: "test",
      },
    ],
  };
}

describe("project lifecycle workspace service", () => {
  it("builds client overview data from the authoritative client-project linkage and project-linked Microsoft context", () => {
    const summaryMap = new Map<number, PlatformProjectSummaryContract>([
      [
        1,
        makeSummary({
          projectInfoId: 1,
          canonicalProjectId: 101,
          projectName: "Alpha Solar",
          clientId: 10,
          clientName: "Acme Energy",
          lifecycleStageLabel: "Construction",
          rawPhase: "P4_CONSTRUCTION_INSTALLATION",
          executionPhase: "Construction",
          isActive: true,
          latestUpdateText: "Grid approval received and civils cleared",
          latestUpdateAt: "2026-03-12T08:00:00.000Z",
          latestUpdateBy: "Pat PM",
          departments: ["engineering", "finance"],
          pendingApprovals: 1,
          approvedApprovals: 2,
          inReviewDeliverables: 1,
          completedDeliverables: 3,
          totalRevenue: 2_000_000,
          totalCost: 1_200_000,
          activeTasks: 7,
          overdueTasks: 1,
        }),
      ],
      [
        2,
        makeSummary({
          projectInfoId: 2,
          canonicalProjectId: 102,
          projectName: "Bravo Storage",
          clientId: 10,
          clientName: "Acme Energy",
          lifecycleStageLabel: "Planning",
          rawPhase: "P1_SCOPING",
          executionPhase: "Planning",
          isActive: false,
          latestUpdateText: null,
          latestUpdateAt: null,
          latestUpdateBy: null,
          departments: ["quality"],
          pendingApprovals: 2,
          approvedApprovals: 0,
          inReviewDeliverables: 0,
          completedDeliverables: 1,
          totalRevenue: 500_000,
          totalCost: 300_000,
          activeTasks: 3,
          overdueTasks: 4,
        }),
      ],
    ]);

    const payload = buildProjectLifecycleWorkspaceFromSources({
      projectRows: [
        {
          id: 1,
          canonicalProjectId: 101,
          projectName: "Alpha Solar",
          clientId: 10,
          phase: "P4_CONSTRUCTION_INSTALLATION",
          executionPhase: "Construction",
          pm: "Pat PM",
          pd: "Dana PD",
          isActive: true,
          archivedStatus: "ACTIVE",
          phaseUpdatedAt: "2026-03-10T09:00:00.000Z",
          executionGateStatus: "ELIGIBLE",
          executionEnabled: true,
          signedStatus: "SIGNED",
          signedDate: "2026-03-01",
          ragStatus: "AMBER",
          escalationLevel: "LOW",
        },
        {
          id: 2,
          canonicalProjectId: 102,
          projectName: "Bravo Storage",
          clientId: 10,
          phase: "P1_SCOPING",
          executionPhase: "Planning",
          pm: "Pat PM",
          pd: "Dana PD",
          isActive: false,
          archivedStatus: "ARCHIVED",
          phaseUpdatedAt: "2026-03-03T09:00:00.000Z",
          executionGateStatus: "BLOCKED",
          executionEnabled: false,
          signedStatus: "NONE",
          signedDate: null,
          ragStatus: "RED",
          escalationLevel: "HIGH",
        },
        {
          id: 3,
          canonicalProjectId: 103,
          projectName: "Charlie Wind",
          clientId: null,
          phase: "P0_FIRST_ASSESSMENT",
          executionPhase: "Assessment",
          pm: null,
          pd: "Dana PD",
          isActive: true,
          archivedStatus: "ACTIVE",
          phaseUpdatedAt: "2026-03-05T09:00:00.000Z",
          executionGateStatus: "BLOCKED",
          executionEnabled: false,
          signedStatus: "NONE",
          signedDate: null,
          ragStatus: null,
          escalationLevel: null,
        },
      ],
      phaseHistoryRows: [
        { projectId: 1, changedAt: "2026-03-10T09:00:00.000Z" },
        { projectId: 1, changedAt: "2026-03-08T09:00:00.000Z" },
        { projectId: 2, changedAt: "2026-03-03T09:00:00.000Z" },
      ],
      microsoftRows: [
        { projectId: 1, type: "email", linkedAt: "2026-03-12T09:00:00.000Z" },
        { projectId: 1, type: "teams", linkedAt: "2026-03-12T10:00:00.000Z" },
        { projectId: 2, type: "event", linkedAt: "2026-03-01T07:00:00.000Z" },
      ],
      clientRows: [
        { id: 10, clientId: "CLI-010", name: "Acme Energy" },
        { id: 11, clientId: "CLI-011", name: "Beacon Utilities" },
      ],
      summaryMap,
    });

    expect(payload.summary.totalProjects).toBe(3);
    expect(payload.summary.projectsWithClientLink).toBe(2);
    expect(payload.summary.clientsWithProjects).toBe(1);

    const acme = payload.clients.find((client) => client.clientId === 10);
    expect(acme).toBeDefined();
    expect(acme).toMatchObject({
      clientCode: "CLI-010",
      clientName: "Acme Energy",
      projectCount: 2,
      activeProjectCount: 1,
      latestUpdateProjectName: "Alpha Solar",
      microsoftLinkedItems: 3,
    });

    expect(acme?.lifecycleDistribution).toEqual([
      { stage: "Construction", count: 1 },
      { stage: "Planning", count: 1 },
    ]);
    expect(acme?.signals.financial).toMatchObject({
      totalRevenue: 2_500_000,
      totalCost: 1_500_000,
      grossMargin: 1_000_000,
      projectsWithFinancialData: 2,
    });
    expect(acme?.signals.quality).toMatchObject({
      pendingApprovals: 3,
      inReviewDeliverables: 1,
      completedDeliverables: 4,
    });
    expect(acme?.signals.risk).toMatchObject({
      blockedProjects: 1,
      projectsMissingLatestUpdate: 1,
      overdueWorkItems: 5,
      escalatedProjects: 1,
      ragRedProjects: 1,
      ragAmberProjects: 1,
    });
    expect(acme?.microsoft).toMatchObject({
      totalLinkedItems: 3,
      linkedProjectCount: 2,
    });
    expect(acme?.microsoft.byType).toMatchObject({
      email: 1,
      event: 1,
      teams: 1,
      sharepoint_file: 0,
      other: 0,
    });
    expect(acme?.latestUpdates.map((update) => update.projectName)).toEqual(["Alpha Solar"]);
    expect(acme?.linkedProjects.map((project) => project.projectName)).toEqual([
      "Alpha Solar",
      "Bravo Storage",
    ]);
  });
});
