import { describe, expect, it } from "vitest";
import {
  buildProjectDevelopmentWorkspaceFromSources,
  computePdPmSubmitBlockers,
} from "../../../server/services/project-development-workspace-service";

describe("project development workspace service", () => {
  it("builds structured PD context from existing intake, dependency, risk, and Microsoft-linked sources", () => {
    const workspace = buildProjectDevelopmentWorkspaceFromSources({
      project: {
        id: 12,
        canonicalProjectId: 9012,
        clientId: 44,
        phase: "P0_FIRST_ASSESSMENT",
        executionGateStatus: "NOT_ELIGIBLE",
        executionEnabled: false,
      },
      handover: {
        deliverables: {
          signedCostProposal: { reference: "cp.pdf" },
        },
        feasibility_status: "FEASIBLE",
        feasibility_notes: "Roof and tariff data validated.",
        dependency_summary: "Awaiting one civils close-out activity.",
        handover_readiness_status: "READY_WITH_ACTIONS",
        handover_readiness_notes: "PM can plan, but civils must close first.",
        engineering_status: "Design pack 90% complete",
        quality_status: "Review booked",
        pm_owner: "Pat PM",
        summary: "Warehouse rooftop solar rollout",
      },
      latestUpdate: {
        text: "Client confirmed commercial terms and approved final site access window.",
        updatedAt: "2026-03-15T08:30:00.000Z",
        updatedBy: "Dana PD",
      },
      intakeRequestRows: [
        {
          id: 1,
          requestType: "Cost Proposal",
          status: "IN PROGRESS",
          priority: "High",
          dueDate: "2026-03-20",
          appNotes: "Waiting for civils crew confirmation.",
          appInternalBlockers: null,
          syncConflict: false,
          cpSigned: true,
          pmCreated: true,
          tasksGenerated: true,
          updatedAt: "2026-03-15T06:00:00.000Z",
        },
      ],
      intakeTaskRows: [
        { id: 101, intakeRequestId: 1, status: "COMPLETED" },
        { id: 102, intakeRequestId: 1, status: "IN_PROGRESS" },
      ],
      pdTicketRows: [
        {
          id: 88,
          requestType: "Feasibility Study",
          status: "In Progress",
          dueDate: "2026-03-21",
          numberOfReworks: 1,
          developerName: "Dana PD",
          designerName: "Evan Eng",
        },
      ],
      pdTicketTaskRows: [{ pdTicketId: 88, total: 3, completed: 2 }],
      workItemRows: [
        { id: 201, title: "Finalize civils scope", status: "In Progress", workstream: "project_development" },
        { id: 202, title: "Release engineering pack", status: "Not Started", workstream: "engineering" },
      ],
      workItemDependencyRows: [{ id: 301, predecessorId: 201, successorId: 202, depType: "FS", lagDays: 0 }],
      raidRows: [
        {
          id: 401,
          type: "risk",
          title: "Civils access window slips",
          status: "open",
          priority: "critical",
          dueDate: "2026-03-19",
          mitigationResponse: "Escalate to site coordinator.",
          updatedAt: "2026-03-15T07:00:00.000Z",
        },
      ],
      microsoftRows: [
        {
          id: 501,
          type: "email",
          subjectOrTitle: "Client access approval",
          senderOrOrganizer: "client@example.com",
          receivedOrStartDatetime: "2026-03-15T08:00:00.000Z",
          webLink: "https://example.com/mail",
          actionRequired: true,
        },
      ],
      communicationTimelineRows: [
        {
          id: 601,
          eventType: "email_linked",
          eventTitle: "Linked client approval email",
          eventDetail: "Added to project communication timeline.",
          createdAt: "2026-03-15T08:05:00.000Z",
        },
      ],
      phaseHistoryRows: [{ projectId: 12, changedAt: "2026-03-14T09:00:00.000Z", toPhase: "P0_FIRST_ASSESSMENT" }],
      platformSummary: {
        project: {
          canonicalProjectId: 9012,
          projectInfoId: 12,
          projectName: "Warehouse Rooftop",
          clientId: 44,
          clientName: "Acme Energy",
          lifecycleStage: "Development",
          lifecycleStageLabel: "Development",
          rawPhase: "P0_FIRST_ASSESSMENT",
          executionPhase: null,
          pmUserId: null,
          pdUserId: null,
          pmName: "Pat PM",
          pdName: "Dana PD",
          isActive: true,
          authoritativeTable: "project_info",
        },
        workspaces: [],
        assignees: [],
        latestUpdate: {
          projectId: 12,
          text: "Client confirmed commercial terms and approved final site access window.",
          updatedAt: "2026-03-15T08:30:00.000Z",
          updatedBy: "Dana PD",
          sourceTable: "project_editable_fields",
        },
        activity: {
          projectId: 12,
          lastActivityAt: "2026-03-15T08:30:00.000Z",
          lastActivitySummary: "Latest update changed",
          lastActivityActor: "Dana PD",
          sourceTable: "project_editable_fields",
        },
        workflow: {
          approvals: { total: 2, pending: 1, approved: 1, rejected: 0 },
          deliverables: { total: 3, pending: 0, inReview: 1, completed: 2 },
        },
        kpis: [
          { id: "finance_total_revenue", name: "Revenue", value: 350000, unit: "currency", sourceTable: "finance", sourceService: "test" },
          { id: "finance_total_cost", name: "Cost", value: 210000, unit: "currency", sourceTable: "finance", sourceService: "test" },
          { id: "tasks_active", name: "Active Work Items", value: 4, unit: "count", sourceTable: "work_items", sourceService: "test" },
        ],
      } as any,
    });

    expect(workspace.spine).toMatchObject({
      projectInfoId: 12,
      canonicalProjectId: 9012,
      clientId: 44,
      phaseHistoryCount: 1,
    });
    expect(workspace.intake.pendingTaskCount).toBe(1);
    expect(workspace.dependencies.blockedWorkItems).toBe(1);
    expect(workspace.risks.critical).toBe(1);
    expect(workspace.microsoft.totalLinkedItems).toBe(1);
    expect(workspace.downstream.projectManagement.deliverablesComplete).toBe(1);
    expect(workspace.downstream.finance.signedCostProposal).toBe(true);
  });

  it("blocks submission when structured PD data or authoritative intake state is incomplete", () => {
    const workspace = buildProjectDevelopmentWorkspaceFromSources({
      project: {
        id: 77,
        canonicalProjectId: 9077,
        clientId: 15,
        phase: "P0_FIRST_ASSESSMENT",
        executionGateStatus: "NOT_ELIGIBLE",
        executionEnabled: false,
      },
      handover: {
        deliverables: {},
        engineering_status: "",
        quality_status: "",
        assumptions: "",
        risks: "",
        summary: "",
        pd_owner: "",
        feasibility_status: "NOT_ASSESSED",
        feasibility_notes: "",
        dependency_summary: "",
        handover_readiness_status: "READY_WITH_ACTIONS",
        handover_readiness_notes: "",
      },
      latestUpdate: { text: null, updatedAt: null, updatedBy: null },
      intakeRequestRows: [
        {
          id: 4,
          requestType: "Cost Proposal",
          status: "IN PROGRESS",
          priority: "High",
          dueDate: "2026-03-20",
          appNotes: null,
          appInternalBlockers: "Site inspection still missing.",
          syncConflict: true,
          cpSigned: false,
          pmCreated: false,
          tasksGenerated: true,
          updatedAt: "2026-03-15T06:00:00.000Z",
        },
      ],
      intakeTaskRows: [{ id: 401, intakeRequestId: 4, status: "NOT_STARTED" }],
      pdTicketRows: [],
      pdTicketTaskRows: [],
      workItemRows: [],
      workItemDependencyRows: [],
      raidRows: [],
      microsoftRows: [],
      communicationTimelineRows: [],
      phaseHistoryRows: [],
    });

    const blockers = computePdPmSubmitBlockers({
      project: { pm: null, pd: null, clientId: 15 },
      handover: {
        deliverables: {},
        engineering_status: "",
        quality_status: "",
        assumptions: "",
        risks: "",
        summary: "",
        pd_owner: "",
        feasibility_status: "NOT_ASSESSED",
        feasibility_notes: "",
        dependency_summary: "",
        handover_readiness_status: "READY_WITH_ACTIONS",
        handover_readiness_notes: "",
      },
      workspace,
    });

    expect(blockers).toEqual(expect.arrayContaining([
      "Handover Charter",
      "Site Visit Report",
      "Signed Cost Proposal",
      "PM assignment",
      "Scope summary",
      "PD owner",
      "Engineering status",
      "Risk summary",
      "Assumptions",
      "Feasibility status",
      "Feasibility notes",
      "Dependency summary",
      "Readiness status set to Ready for handover",
      "Handover readiness notes",
      "Canonical latest update",
      "Resolve intake sync conflicts",
      "Clear intake internal blockers",
      "Complete linked intake tasks",
    ]));
  });
});
