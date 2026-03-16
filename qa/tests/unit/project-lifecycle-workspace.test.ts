import { describe, expect, it } from "vitest";
import {
  buildMicrosoftBreakdownItems,
  filterProjectLifecycleClients,
  filterProjectLifecycleProjects,
  getProjectGateVariant,
  sortProjectsByLatestUpdate,
  type ProjectLifecycleWorkspaceClient,
  type ProjectLifecycleWorkspaceProject,
} from "@/lib/project-lifecycle-workspace";

function makeProject(overrides: Partial<ProjectLifecycleWorkspaceProject> = {}): ProjectLifecycleWorkspaceProject {
  return {
    projectInfoId: 1,
    canonicalProjectId: 1,
    projectName: "Alpha Solar",
    clientId: 10,
    clientName: "Acme Energy",
    lifecycleStage: "P4_CONSTRUCTION_INSTALLATION",
    lifecycleStageLabel: "Construction",
    rawPhase: "P4_CONSTRUCTION_INSTALLATION",
    executionPhase: "Construction",
    pmName: "Pat PM",
    pdName: "Dana PD",
    isActive: true,
    archivedStatus: "ACTIVE",
    phaseUpdatedAt: "2026-03-10T09:00:00.000Z",
    stageHistory: { count: 4, lastChangedAt: "2026-03-10T09:00:00.000Z" },
    stageGate: {
      executionGateStatus: "BLOCKED",
      executionEnabled: false,
      signedStatus: "NONE",
      signedDate: null,
    },
    latestUpdate: {
      text: "Waiting on grid approval",
      updatedAt: "2026-03-12T08:00:00.000Z",
      updatedBy: "Pat PM",
    },
    workflow: {
      approvals: { total: 2, pending: 1, approved: 1, rejected: 0 },
      deliverables: { total: 3, pending: 1, inReview: 1, completed: 1 },
    },
    departments: ["engineering", "finance"],
    microsoft: {
      totalLinkedItems: 3,
      byType: { email: 1, event: 1, teams: 1, sharepoint_file: 0, other: 0 },
      latestLinkedAt: "2026-03-11T08:00:00.000Z",
    },
    ...overrides,
  };
}

function makeClient(overrides: Partial<ProjectLifecycleWorkspaceClient> = {}): ProjectLifecycleWorkspaceClient {
  return {
    clientId: 10,
    clientCode: "CLI-010",
    clientName: "Acme Energy",
    projectCount: 2,
    activeProjectCount: 1,
    lifecycleStages: ["Construction", "Closeout"],
    departmentCoverage: ["engineering", "finance"],
    latestUpdateAt: "2026-03-12T08:00:00.000Z",
    latestUpdateProjectName: "Alpha Solar",
    microsoftLinkedItems: 3,
    ...overrides,
  };
}

describe("project lifecycle workspace helpers", () => {
  it("filters projects across lifecycle, client, update, and department fields", () => {
    const projects = [
      makeProject(),
      makeProject({
        projectInfoId: 2,
        canonicalProjectId: 2,
        projectName: "Beta Storage",
        clientName: "Zenith Power",
        latestUpdate: { text: "Awaiting civils handover", updatedAt: "2026-03-08T08:00:00.000Z", updatedBy: "Dana PD" },
        departments: ["quality"],
      }),
    ];

    expect(filterProjectLifecycleProjects(projects, "grid approval")).toHaveLength(1);
    expect(filterProjectLifecycleProjects(projects, "zenith")).toHaveLength(1);
    expect(filterProjectLifecycleProjects(projects, "quality")).toHaveLength(1);
    expect(filterProjectLifecycleProjects(projects, "construction")).toHaveLength(2);
  });

  it("sorts projects by most recent canonical latest update", () => {
    const projects = [
      makeProject({ projectInfoId: 2, canonicalProjectId: 2, projectName: "Beta", latestUpdate: { text: "Older", updatedAt: "2026-03-01T08:00:00.000Z", updatedBy: "B" } }),
      makeProject({ projectInfoId: 3, canonicalProjectId: 3, projectName: "Gamma", latestUpdate: { text: "Newest", updatedAt: "2026-03-15T08:00:00.000Z", updatedBy: "C" } }),
      makeProject({ projectInfoId: 1, canonicalProjectId: 1, projectName: "Alpha", latestUpdate: { text: null, updatedAt: null, updatedBy: null } }),
    ];

    expect(sortProjectsByLatestUpdate(projects).map((project) => project.projectName)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("classifies gate visibility without creating a parallel stage-gate model", () => {
    expect(getProjectGateVariant(makeProject({ stageGate: { executionGateStatus: "BLOCKED", executionEnabled: true, signedStatus: "SIGNED", signedDate: "2026-03-10" } }))).toBe("enabled");
    expect(getProjectGateVariant(makeProject({ stageGate: { executionGateStatus: "ELIGIBLE", executionEnabled: false, signedStatus: "SIGNED", signedDate: "2026-03-10" } }))).toBe("eligible");
    expect(getProjectGateVariant(makeProject({ stageGate: { executionGateStatus: "BLOCKED", executionEnabled: false, signedStatus: "SIGNED", signedDate: "2026-03-10" } }))).toBe("pending");
    expect(getProjectGateVariant(makeProject())).toBe("blocked");
  });

  it("filters client overview entries across code, stage spread, and departments", () => {
    const clients = [
      makeClient(),
      makeClient({
        clientId: 11,
        clientCode: "CLI-011",
        clientName: "Beacon Utilities",
        lifecycleStages: ["Planning"],
        departmentCoverage: ["quality"],
        latestUpdateProjectName: "Beta Storage",
      }),
    ];

    expect(filterProjectLifecycleClients(clients, "cli-011")).toHaveLength(1);
    expect(filterProjectLifecycleClients(clients, "planning")).toHaveLength(1);
    expect(filterProjectLifecycleClients(clients, "finance")).toHaveLength(1);
  });

  it("builds only populated Microsoft breakdown items", () => {
    expect(
      buildMicrosoftBreakdownItems({
        email: 2,
        event: 0,
        teams: 1,
        sharepoint_file: 0,
        other: 0,
      }).map((item) => item.label),
    ).toEqual(["Email", "Teams"]);
  });
});
