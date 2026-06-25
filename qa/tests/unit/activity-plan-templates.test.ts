// Verifies the Activity-Planning link templates: building a template derives
// keyword rules from a project's existing links, and applying one re-creates the
// milestone→task→outflow links on another project by matching milestone / task /
// outflow words (skipping links that already exist).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mtRepo, tplRepo } = vi.hoisted(() => ({
  mtRepo: {
    getRevenueMilestonesForProjects: vi.fn(),
    getCostLinesForProjects: vi.fn(),
    getPlanTasksForProjects: vi.fn(),
    getMilestoneTaskLinksForProjects: vi.fn(),
    getTaskCostLinksForProjects: vi.fn(),
    getDependenciesByWorkItemIds: vi.fn(),
    addMilestoneTaskLink: vi.fn(),
    addTaskCostLink: vi.fn(),
  },
  tplRepo: { getById: vi.fn(), create: vi.fn(), list: vi.fn(), softDelete: vi.fn(), update: vi.fn() },
}));
vi.mock("../../../server/repositories/milestone-tracker-repository", () => ({ milestoneTrackerRepository: mtRepo }));
vi.mock("../../../server/repositories/activity-plan-template-repository", () => ({ activityPlanTemplateRepository: tplRepo }));
vi.mock("../../../server/repositories/execution-board-repository", () => ({ executionBoardRepository: {} }));

import { applyTemplateToProject, createTemplateFromProject, updateActivityTemplate } from "../../../server/services/milestone-tracker-service";

const milestones = [
  { projectId: 1, rowHash: "m1", milestoneNo: "1", milestoneName: "Acceptance and Initial Deposit" },
  { projectId: 1, rowHash: "m2", milestoneNo: "3", milestoneName: "Delivery of Inverters" },
];
const tasks = [
  { id: 10, projectId: 1, taskNo: "5.1", title: "Install inverters", percentComplete: 0 },
  { id: 11, projectId: 1, taskNo: "1.1", title: "Acceptance signoff", percentComplete: 0 },
];
const costs = [
  { projectId: 1, rowHash: "c1", description: "MSA - Huawei inverter 100KTL", costCategory: "2. Inverters", status: "planned" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mtRepo.getRevenueMilestonesForProjects.mockResolvedValue(milestones);
  mtRepo.getCostLinesForProjects.mockResolvedValue(costs);
  mtRepo.getPlanTasksForProjects.mockResolvedValue(tasks);
  mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([]);
  mtRepo.getTaskCostLinksForProjects.mockResolvedValue([]);
  mtRepo.getDependenciesByWorkItemIds.mockResolvedValue([]);
  mtRepo.addMilestoneTaskLink.mockResolvedValue(undefined);
  mtRepo.addTaskCostLink.mockResolvedValue(undefined);
});

describe("applyTemplateToProject", () => {
  it("links milestones/tasks/outflows that match the rule keywords", async () => {
    tplRepo.getById.mockResolvedValue({
      id: 7, name: "Std", rules: [
        { label: "Inverters", milestoneKeywords: ["inverters"], taskKeywords: ["install"], outflowKeywords: ["huawei"] },
      ],
    });
    const r = await applyTemplateToProject(1, 7, 99);
    expect(r).toEqual({ milestoneTaskLinks: 1, taskCostLinks: 1, rulesMatched: 1, rulesTotal: 1 });
    expect(mtRepo.addMilestoneTaskLink).toHaveBeenCalledWith({ projectId: 1, revenueRowHash: "m2", workItemId: 10, createdBy: 99 });
    expect(mtRepo.addTaskCostLink).toHaveBeenCalledWith({ projectId: 1, workItemId: 10, costRowHash: "c1", createdBy: 99 });
    // m1 ("Acceptance…") must NOT be linked by the inverters rule
    expect(mtRepo.addMilestoneTaskLink).toHaveBeenCalledTimes(1);
  });

  it("skips links that already exist", async () => {
    mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([{ revenueRowHash: "m2", workItemId: 10 }]);
    mtRepo.getTaskCostLinksForProjects.mockResolvedValue([{ workItemId: 10, costRowHash: "c1" }]);
    tplRepo.getById.mockResolvedValue({
      id: 7, name: "Std", rules: [{ label: "Inverters", milestoneKeywords: ["inverters"], taskKeywords: ["install"], outflowKeywords: ["huawei"] }],
    });
    const r = await applyTemplateToProject(1, 7, 99);
    expect(r.milestoneTaskLinks).toBe(0);
    expect(r.taskCostLinks).toBe(0);
    expect(r.rulesMatched).toBe(1); // the rule still matched rows
    expect(mtRepo.addMilestoneTaskLink).not.toHaveBeenCalled();
  });

  it("a rule that matches no milestone or task creates nothing", async () => {
    tplRepo.getById.mockResolvedValue({
      id: 7, name: "Std", rules: [{ label: "Civils", milestoneKeywords: ["nonsense"], taskKeywords: ["civil"], outflowKeywords: [] }],
    });
    const r = await applyTemplateToProject(1, 7, 99);
    expect(r).toEqual({ milestoneTaskLinks: 0, taskCostLinks: 0, rulesMatched: 0, rulesTotal: 1 });
  });
});

describe("createTemplateFromProject", () => {
  it("derives keyword rules from the project's existing links", async () => {
    mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([{ revenueRowHash: "m2", workItemId: 10 }]);
    mtRepo.getTaskCostLinksForProjects.mockResolvedValue([{ workItemId: 10, costRowHash: "c1" }]);
    tplRepo.create.mockImplementation(async (input: unknown) => ({ id: 1, ...(input as object) }));

    await createTemplateFromProject(1, "Standard C&I", null, 99);
    expect(tplRepo.create).toHaveBeenCalledTimes(1);
    const arg = tplRepo.create.mock.calls[0][0] as { name: string; rules: Array<{ milestoneKeywords: string[]; taskKeywords: string[]; outflowKeywords: string[] }> };
    expect(arg.name).toBe("Standard C&I");
    expect(arg.rules).toHaveLength(1);
    const rule = arg.rules[0];
    expect(rule.milestoneKeywords).toContain("inverters"); // from "Delivery of Inverters"
    expect(rule.taskKeywords).toContain("install");        // from "Install inverters"
    expect(rule.outflowKeywords).toContain("huawei");      // from the linked cost description
  });

  it("throws when the project has no links to capture", async () => {
    await expect(createTemplateFromProject(1, "Empty", null, 99)).rejects.toThrow(/no milestone/i);
    expect(tplRepo.create).not.toHaveBeenCalled();
  });
});

describe("updateActivityTemplate", () => {
  it("passes the patch through and returns the updated template", async () => {
    const patch = { name: "Renamed", rules: [{ label: "R", milestoneKeywords: ["x"], taskKeywords: ["y"], outflowKeywords: [] }] };
    tplRepo.update.mockResolvedValue({ id: 7, name: "Renamed", description: null, rules: patch.rules, createdBy: 1, createdAt: new Date() });
    const r = await updateActivityTemplate(7, patch);
    expect(tplRepo.update).toHaveBeenCalledWith(7, patch);
    expect(r.name).toBe("Renamed");
  });

  it("throws when the template does not exist", async () => {
    tplRepo.update.mockResolvedValue(null);
    await expect(updateActivityTemplate(999, { name: "x" })).rejects.toThrow(/not found/i);
  });
});
