// Verifies that links made in Activity Planning CASCADE into the program- and
// project-level rollups (the user's "you should see what has been linked
// already"), driving the REAL service with controlled repository data.
//
// The hub model is inflow milestone ← plan task → outflow cost line: the task is
// always in the middle. A milestone "earns" an outflow only when the chain
// milestone→task→cost is complete.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RevenueMilestoneRow, CostLineRow, MtPlanTaskRow } from "../../../server/repositories/milestone-tracker-repository";

// ── mock the two repository singletons the service reads through ──
// vi.hoisted so the mock objects exist when the hoisted vi.mock factories run.
const { mtRepo, ebRepo } = vi.hoisted(() => ({
  mtRepo: {
    getRevenueMilestonesForProjects: vi.fn(),
    getCostLinesForProjects: vi.fn(),
    getPlanTasksForProjects: vi.fn(),
    getMilestoneTaskLinksForProjects: vi.fn(),
    getTaskCostLinksForProjects: vi.fn(),
    getDependenciesByWorkItemIds: vi.fn(),
  },
  ebRepo: {
    getProjectHeader: vi.fn(),
    getActiveProjects: vi.fn(),
  },
}));
vi.mock("../../../server/repositories/milestone-tracker-repository", () => ({
  milestoneTrackerRepository: mtRepo,
}));
vi.mock("../../../server/repositories/execution-board-repository", () => ({
  executionBoardRepository: ebRepo,
}));

import { getProjectMilestones, getMilestoneProgram } from "../../../server/services/milestone-tracker-service";

const PROJECT = { id: 1, projectName: "Test Site", phase: "5 Construction" };

function milestone(): RevenueMilestoneRow {
  return {
    projectId: 1, rowHash: "m1", milestoneNo: "1", milestoneName: "Delivery",
    milestonePercent: "30", amountExVat: "100000", invoiceNumber: "INV-1",
    invoiceDate: "2026-06-01", expectedPaymentDate: "2026-07-01", paidDate: null,
    paidDateConfirmed: null, inBankDate: null, status: "invoiced", milestoneNotes: null,
  };
}
function cost(): CostLineRow {
  return {
    projectId: 1, rowHash: "c1", costCategory: "1. Panels", counterpartyName: "Jinko",
    description: "MSA - Jinko 625W", amountExVat: "40000", invoiceNumber: null,
    invoiceDate: null, approvedDate: null, paidDate: "2026-06-15",
    forecastPaymentDate: null, poNumber: null, status: "paid",
  };
}
function task(): MtPlanTaskRow {
  return {
    id: 10, projectId: 1, taskNo: "1", title: "Install panels", workstream: null,
    phase: null, startDate: "2026-06-01", endDate: "2026-06-30", actualStart: null,
    actualEnd: null, percentComplete: 0, isMilestone: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ebRepo.getProjectHeader.mockResolvedValue({ ...PROJECT });
  ebRepo.getActiveProjects.mockResolvedValue([{ ...PROJECT }]);
  mtRepo.getRevenueMilestonesForProjects.mockResolvedValue([milestone()]);
  mtRepo.getCostLinesForProjects.mockResolvedValue([cost()]);
  mtRepo.getPlanTasksForProjects.mockResolvedValue([task()]);
  mtRepo.getDependenciesByWorkItemIds.mockResolvedValue([]);
  // links default to none; each test sets them
  mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([]);
  mtRepo.getTaskCostLinksForProjects.mockResolvedValue([]);
});

describe("Activity Planning link cascade", () => {
  it("full chain milestone→task→cost rolls up at project AND program level", async () => {
    mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([{ projectId: 1, revenueRowHash: "m1", workItemId: 10 }]);
    mtRepo.getTaskCostLinksForProjects.mockResolvedValue([{ projectId: 1, workItemId: 10, costRowHash: "c1" }]);

    const detail = await getProjectMilestones(1, new Date("2026-06-23"));
    expect(detail).not.toBeNull();
    // milestone shows its task, the task shows its outflow
    expect(detail!.milestones[0].tasks).toHaveLength(1);
    expect(detail!.milestones[0].outflows).toHaveLength(1);
    expect(detail!.milestones[0].outflowTotal).toBe(40000);
    // project "Linked outflow" KPI reflects it
    expect(detail!.summary.outflowTotal).toBe(40000);
    // the cost line is now task-linked, so it leaves the "Outflows not linked" worklist
    expect(detail!.outflowItems[0].linkedTaskIds).toEqual([10]);

    const program = await getMilestoneProgram(new Date("2026-06-23"));
    const row = program.rows.find((r) => r.projectId === 1)!;
    expect(row.linkedMilestoneCount).toBe(1); // milestone has a task
    expect(row.outflowTotal).toBe(40000);      // linked outflow cascaded to program
  });

  it("with no links, the cost line is on the not-linked worklist and nothing is linked", async () => {
    const detail = await getProjectMilestones(1, new Date("2026-06-23"));
    expect(detail!.milestones[0].tasks).toHaveLength(0);
    expect(detail!.summary.outflowTotal).toBe(0);
    // unlinked cost line surfaces on the worklist regardless of PAID status
    expect(detail!.outflowItems[0].linkedTaskIds).toHaveLength(0);
    expect(detail!.outflowItems[0].state).toBe("paid"); // shown WITH its status

    const program = await getMilestoneProgram(new Date("2026-06-23"));
    const row = program.rows.find((r) => r.projectId === 1)!;
    expect(row.linkedMilestoneCount).toBe(0);
    expect(row.outflowTotal).toBe(0);
  });

  it("partial chain (task→cost only, no milestone→task): cost is task-linked but does NOT count toward the milestone-earned Linked-outflow total", async () => {
    // This documents the hub rule: an outflow is only "earned" by a milestone
    // once the FULL chain exists. Task-level linkage removes it from the
    // not-linked worklist, but the project Linked-outflow KPI (milestone-earned)
    // stays 0 until the task is also linked to a milestone.
    mtRepo.getTaskCostLinksForProjects.mockResolvedValue([{ projectId: 1, workItemId: 10, costRowHash: "c1" }]);

    const detail = await getProjectMilestones(1, new Date("2026-06-23"));
    expect(detail!.outflowItems[0].linkedTaskIds).toEqual([10]); // task-linked → off worklist
    expect(detail!.summary.outflowTotal).toBe(0);                // not milestone-earned yet
  });
});
