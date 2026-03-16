import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/components/tasks/types";
import { deriveEngineeringTaskMetrics, filterEngineeringTasks } from "@/hooks/useEngineeringTaskFilters";

function task(overrides: Partial<Task> & { id: number; title: string }): Task {
  return {
    id: overrides.id,
    projectName: null,
    title: overrides.title,
    description: null,
    status: "TO DO",
    priority: "Medium",
    phase: null,
    primaryWorkstream: null,
    ownerUserId: null,
    approverUserId: null,
    assigneeUserId: null,
    assigneeUserIds: null,
    dueDate: null,
    startDate: null,
    percentComplete: 0,
    holdReason: null,
    blockedType: null,
    approvalRequired: null,
    trackingRag: null,
    summaryText: null,
    taskTypeTag: null,
    externalSource: null,
    externalTaskId: null,
    parentTaskId: null,
    linkedPlanItemId: null,
    linkedDeliverableId: null,
    linkedQualityItemInstanceId: null,
    assignees: null,
    watchers: null,
    tags: null,
    createdAt: "2026-03-15T08:00:00.000Z",
    updatedAt: "2026-03-15T08:00:00.000Z",
    resolvedOwner: null,
    resolvedAssignees: [],
    isUnassigned: false,
    isBlocked: false,
    isReviewNeeded: false,
    isApprovalPending: false,
    projectLinkedDeliverableCount: 0,
    approvalPendingDeliverableCount: 0,
    projectLinkedDeliverables: [],
    deliverableContextHref: null,
    deliverableContextLabel: null,
    projectHref: null,
    sourceHref: null,
    sourceContextLabel: null,
    externalHref: null,
    hasMicrosoftContext: false,
    microsoftActionRequiredCount: 0,
    relatedMicrosoftItems: [],
    ...overrides,
  };
}

describe("engineering task filters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tasks: Task[] = [
    task({
      id: 1,
      title: "Overdue inverter review",
      projectName: "Solar Alpha",
      status: "IN PROGRESS",
      dueDate: "2026-03-12",
      resolvedAssignees: [{ id: 10, name: "Eon", username: "eon", role: "ENGINEER" }],
      assigneeUserIds: [10],
      projectLinkedDeliverableCount: 2,
      projectLinkedDeliverables: [
        { id: 201, title: "Alpha IFC pack", status: "PENDING REVIEW", updatedAt: "2026-03-15T10:00:00.000Z" },
      ],
      deliverableContextLabel: "Open deliverables",
      sourceContextLabel: "Open engineering task",
      hasMicrosoftContext: true,
      microsoftActionRequiredCount: 1,
      relatedMicrosoftItems: [
        {
          id: 301,
          linkedTaskId: 1,
          type: "teams",
          title: "Teams action",
          webLink: "https://teams.microsoft.com/l/message/301",
          actionRequired: true,
          receivedOrStartDatetime: "2026-03-15T09:00:00.000Z",
          sourceHref: "/project/Solar%20Alpha?mode=execution",
          sourceContextLabel: "Open linked project task",
          externalHref: "https://teams.microsoft.com/l/message/301",
        },
      ],
    }),
    task({
      id: 2,
      title: "Blocked cable route",
      projectName: "Solar Alpha",
      status: "HOLD",
      dueDate: "2026-03-18",
      isBlocked: true,
      isUnassigned: true,
      holdReason: "Awaiting site measurements",
    }),
    task({
      id: 3,
      title: "Review earthing comments",
      projectName: "Solar Beta",
      status: "PROVIDE FEEDBACK",
      isReviewNeeded: true,
      resolvedAssignees: [{ id: 11, name: "Mira", username: "mira", role: "ENGINEER" }],
      assigneeUserIds: [11],
    }),
    task({
      id: 4,
      title: "Approval pack",
      projectName: null,
      status: "NEEDS APPROVAL",
      isApprovalPending: true,
      resolvedAssignees: [{ id: 12, name: "Johan", username: "johan", role: "ENGINEER" }],
      assigneeUserIds: [12],
    }),
    task({
      id: 5,
      title: "Completed closeout",
      projectName: "Solar Gamma",
      status: "COMPLETE",
      dueDate: "2026-03-10",
    }),
  ];

  it("derives workload metrics for standup-style engineering triage", () => {
    const metrics = deriveEngineeringTaskMetrics(tasks);

    expect(metrics.openTasks.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(metrics.overdueTasks.map((item) => item.id)).toEqual([1]);
    expect(metrics.holdTasks.map((item) => item.id)).toEqual([2]);
    expect(metrics.unassignedTasks.map((item) => item.id)).toEqual([2]);
    expect(metrics.blockedTasks.map((item) => item.id)).toEqual([2]);
    expect(metrics.reviewNeededTasks.map((item) => item.id)).toEqual([3]);
    expect(metrics.approvalPendingTasks.map((item) => item.id)).toEqual([4]);
    expect(metrics.projectLinkedDeliverableTasks.map((item) => item.id)).toEqual([1]);
    expect(metrics.microsoftLinkedTasks.map((item) => item.id)).toEqual([1]);
    expect(metrics.microsoftActionTasks.map((item) => item.id)).toEqual([1]);
  });

  it("filters engineering work by due date, workload state, linked source, and resolved assignee names", () => {
    expect(
      filterEngineeringTasks({
        tasks,
        statusFilter: "all",
        priorityFilter: "all",
        assigneeFilter: "all",
        projectFilter: "all",
        searchTerm: "",
        dueDateFilter: "overdue",
        workloadStateFilter: "all",
        linkedSourceFilter: "all",
      }).map((item) => item.id),
    ).toEqual([1]);

    expect(
      filterEngineeringTasks({
        tasks,
        statusFilter: "all",
        priorityFilter: "all",
        assigneeFilter: "all",
        projectFilter: "all",
        searchTerm: "",
        dueDateFilter: "all",
        workloadStateFilter: "blocked",
        linkedSourceFilter: "all",
      }).map((item) => item.id),
    ).toEqual([2]);

    expect(
      filterEngineeringTasks({
        tasks,
        statusFilter: "all",
        priorityFilter: "all",
        assigneeFilter: "all",
        projectFilter: "all",
        searchTerm: "",
        dueDateFilter: "all",
        workloadStateFilter: "approval",
        linkedSourceFilter: "project_unlinked",
      }).map((item) => item.id),
    ).toEqual([4]);

    expect(
      filterEngineeringTasks({
        tasks,
        statusFilter: "all",
        priorityFilter: "all",
        assigneeFilter: "Eon",
        projectFilter: "Solar Alpha",
        searchTerm: "ifc",
        dueDateFilter: "all",
        workloadStateFilter: "deliverable",
        linkedSourceFilter: "microsoft_linked",
      }).map((item) => item.id),
    ).toEqual([1]);
  });
});
