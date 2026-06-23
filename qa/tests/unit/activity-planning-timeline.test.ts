// Verifies the Timeline/scheduler activity builder: a "built activity" appears
// only when an inflow milestone is wired to a task, and the two axes compute
// from the existing logic — SCHEDULE positive = no linked task overdue;
// CASHFLOW positive = money-in date lands before the amount-weighted money-out
// date (the same timing the milestone GP card shows).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RevenueMilestoneRow, CostLineRow, MtPlanTaskRow } from "../../../server/repositories/milestone-tracker-repository";

const { mtRepo, ebRepo } = vi.hoisted(() => ({
  mtRepo: {
    getRevenueMilestonesForProjects: vi.fn(),
    getCostLinesForProjects: vi.fn(),
    getPlanTasksForProjects: vi.fn(),
    getMilestoneTaskLinksForProjects: vi.fn(),
    getTaskCostLinksForProjects: vi.fn(),
    getDependenciesByWorkItemIds: vi.fn(),
  },
  ebRepo: { getProjectHeader: vi.fn(), getActiveProjects: vi.fn() },
}));
vi.mock("../../../server/repositories/milestone-tracker-repository", () => ({ milestoneTrackerRepository: mtRepo }));
vi.mock("../../../server/repositories/execution-board-repository", () => ({ executionBoardRepository: ebRepo }));

import { getProjectMilestones } from "../../../server/services/milestone-tracker-service";

const TODAY = new Date("2026-06-23");

function milestone(over: Partial<RevenueMilestoneRow> = {}): RevenueMilestoneRow {
  return {
    projectId: 1, rowHash: "m1", milestoneNo: "1", milestoneName: "Delivery",
    milestonePercent: "30", amountExVat: "100000", invoiceNumber: null,
    invoiceDate: null, expectedPaymentDate: "2026-07-01", paidDate: null,
    paidDateConfirmed: null, inBankDate: null, status: "invoiced", milestoneNotes: null, ...over,
  };
}
function cost(over: Partial<CostLineRow> = {}): CostLineRow {
  return {
    projectId: 1, rowHash: "c1", costCategory: "1. Panels", counterpartyName: "Jinko",
    description: "MSA - Jinko 625W", amountExVat: "40000", invoiceNumber: null,
    invoiceDate: null, approvedDate: null, paidDate: null,
    forecastPaymentDate: "2026-09-01", poNumber: null, status: "planned", ...over,
  };
}
function task(over: Partial<MtPlanTaskRow> = {}): MtPlanTaskRow {
  return {
    id: 10, projectId: 1, taskNo: "1", title: "Install panels", workstream: null,
    phase: null, startDate: "2026-06-01", endDate: "2026-08-01", actualStart: null,
    actualEnd: null, percentComplete: 0, isMilestone: false, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ebRepo.getProjectHeader.mockResolvedValue({ id: 1, projectName: "Test Site", phase: "5 Construction" });
  ebRepo.getActiveProjects.mockResolvedValue([{ id: 1, projectName: "Test Site", phase: "5 Construction" }]);
  mtRepo.getRevenueMilestonesForProjects.mockResolvedValue([milestone()]);
  mtRepo.getCostLinesForProjects.mockResolvedValue([cost()]);
  mtRepo.getPlanTasksForProjects.mockResolvedValue([task()]);
  mtRepo.getDependenciesByWorkItemIds.mockResolvedValue([]);
  mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([{ projectId: 1, revenueRowHash: "m1", workItemId: 10 }]);
  mtRepo.getTaskCostLinksForProjects.mockResolvedValue([{ projectId: 1, workItemId: 10, costRowHash: "c1" }]);
});

describe("Activity timeline builder", () => {
  it("builds an activity only when the milestone has a linked task", async () => {
    mtRepo.getMilestoneTaskLinksForProjects.mockResolvedValue([]); // unlink
    const detail = await getProjectMilestones(1, TODAY);
    expect(detail!.activities).toHaveLength(0);
  });

  it("on-time work + money-in-before-out = schedule positive + cashflow positive", async () => {
    const detail = await getProjectMilestones(1, TODAY);
    expect(detail!.activities).toHaveLength(1);
    const a = detail!.activities[0];
    expect(a.scheduleState).toBe("positive");   // task ends 2026-08-01 (future) → not overdue
    expect(a.overdueTaskCount).toBe(0);
    expect(a.cashflowState).toBe("positive");    // out 2026-09-01 after in 2026-07-01
    expect(a.cashflowDays).toBeGreaterThan(0);
    expect(a.inflow?.date).toBe("2026-07-01");
    expect(a.outflows[0].date).toBe("2026-09-01");
    expect(a.taskStart).toBe("2026-06-01");
    expect(a.taskEnd).toBe("2026-08-01");
    expect(a.outflowTotal).toBe(40000);
  });

  it("overdue work + money-out-before-in = schedule negative + cashflow negative", async () => {
    mtRepo.getPlanTasksForProjects.mockResolvedValue([task({ endDate: "2026-01-01" })]); // past → overdue
    mtRepo.getCostLinesForProjects.mockResolvedValue([cost({ forecastPaymentDate: "2026-05-01" })]); // before money-in
    const detail = await getProjectMilestones(1, TODAY);
    const a = detail!.activities[0];
    expect(a.scheduleState).toBe("negative");
    expect(a.overdueTaskCount).toBe(1);
    expect(a.cashflowState).toBe("negative");
    expect(a.cashflowDays).toBeLessThan(0);
  });

  it("realised flags follow paid status (solid vs forecast marker)", async () => {
    mtRepo.getRevenueMilestonesForProjects.mockResolvedValue([milestone({ paidDate: "2026-06-20", paidDateConfirmed: true })]);
    mtRepo.getCostLinesForProjects.mockResolvedValue([cost({ status: "paid", paidDate: "2026-06-10" })]);
    const detail = await getProjectMilestones(1, TODAY);
    const a = detail!.activities[0];
    expect(a.inflow?.realised).toBe(true);       // black/confirmed receipt → realised
    expect(a.outflows[0].realised).toBe(true);   // paid cost line → realised
  });
});
