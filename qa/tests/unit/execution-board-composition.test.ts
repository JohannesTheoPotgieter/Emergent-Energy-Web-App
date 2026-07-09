// Board composition guards:
//  B2 — the board's Overdue-deliveries KPI is built from the SAME delivery-row
//       model as the program Deliveries list, so the two agree (including
//       plan-task deliveries, which the old shortcut under-counted).
//  C2 — the board's Eng/QA columns use the real Engineering / Quality module
//       when the project has data there, and fall back to the plan-workstream
//       rollup only when empty.
// Repositories are mocked (no DB), mirroring deliveries-rag-consistency.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { repo, reviewRepo } = vi.hoisted(() => ({
  repo: {
    getActiveProjects: vi.fn(),
    getPlanTasksForProjects: vi.fn(),
    getPlanTasksForProject: vi.fn(),
    getInstallersForProjects: vi.fn(),
    getDeliveryMilestonesForProjects: vi.fn(),
    getProcurementDeliveriesForProjects: vi.fn(),
    getOpenProcurementForProjects: vi.fn(),
    getEngStagesForProjects: vi.fn(),
    getOpenEngTaskCounts: vi.fn(),
    getSnagsForProjects: vi.fn(),
    getQcLinkedProjectIds: vi.fn(),
    getUserNamesByIds: vi.fn(),
    getProjectHeader: vi.fn(),
    getLatestUpdate: vi.fn(),
  },
  reviewRepo: { getCountsByProjects: vi.fn() },
}));
vi.mock("../../../server/repositories/execution-board-repository", () => ({ executionBoardRepository: repo }));
vi.mock("../../../server/repositories/execution-review-repository", () => ({ executionReviewRepository: reviewRepo }));

import { getBoard, getDeliveriesProgram, getProjectDetail } from "../../../server/services/execution-board-service";

const TODAY = new Date("2026-06-24T00:00:00Z");

function activeProject(over: Record<string, unknown> = {}) {
  return {
    id: 1, projectName: "Site A", phase: "Construction",
    pmUserId: null, pdUserId: null, pmText: null, pdText: null,
    sizeKwp: null, contractValue: null, ragStatus: null,
    constructionStartDate: null, commissioningDate: null, omHandoverDate: null, clientHandoverDate: null,
    ...over,
  };
}
function planTask(over: Record<string, unknown> = {}) {
  return {
    id: undefined, taskNo: null, taskName: "Task", phase: null, workstream: "PM",
    startDate: null, endDate: null, actualStartDate: null, actualEndDate: null,
    durationDays: null, pctComplete: null, expectedPctComplete: null,
    isMilestone: false, parentTaskNo: null, comment: null, ...over,
  };
}
function milestone(over: Record<string, unknown> = {}) {
  return { id: 1, projectId: 1, milestoneName: "M", plannedDate: null, actualDate: null, status: "planned", blocker: null, ...over };
}
function procurement(over: Record<string, unknown> = {}) {
  return {
    id: 5, projectId: 1, title: "Order", status: "ordered", requiredDate: null,
    leadTimeDays: null, orderDate: null, deliveryExpectedDate: null, deliveryActualDate: null,
    deliveryStatus: null, isLongLead: false, linkedWorkItemId: null,
    taskNo: null, taskTitle: null, taskStartDate: null, taskEndDate: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getActiveProjects.mockResolvedValue([activeProject()]);
  repo.getPlanTasksForProjects.mockResolvedValue(new Map());
  repo.getPlanTasksForProject.mockResolvedValue({ runId: null, importedAt: null, tasks: [] });
  repo.getInstallersForProjects.mockResolvedValue([]);
  repo.getDeliveryMilestonesForProjects.mockResolvedValue([]);
  repo.getProcurementDeliveriesForProjects.mockResolvedValue([]);
  repo.getOpenProcurementForProjects.mockResolvedValue([]);
  repo.getEngStagesForProjects.mockResolvedValue([]);
  repo.getOpenEngTaskCounts.mockResolvedValue(new Map());
  repo.getSnagsForProjects.mockResolvedValue([]);
  repo.getQcLinkedProjectIds.mockResolvedValue(new Set());
  repo.getUserNamesByIds.mockResolvedValue(new Map());
  repo.getProjectHeader.mockResolvedValue(activeProject());
  repo.getLatestUpdate.mockResolvedValue(undefined);
  reviewRepo.getCountsByProjects.mockResolvedValue(new Map());
});

describe("board Overdue KPI == Deliveries-page overdue count (B1/B2)", () => {
  beforeEach(() => {
    // One overdue milestone + one overdue procurement order + one overdue
    // delivery-named plan task, plus a non-overdue future milestone.
    repo.getDeliveryMilestonesForProjects.mockResolvedValue([
      milestone({ id: 1, milestoneName: "Grid", plannedDate: "2026-06-01" }),      // overdue
      milestone({ id: 2, milestoneName: "COD", plannedDate: "2026-12-01" }),        // future
    ]);
    repo.getProcurementDeliveriesForProjects.mockResolvedValue([
      procurement({ id: 5, title: "Inverters", taskStartDate: "2026-06-10" }),     // overdue
    ]);
    repo.getPlanTasksForProjects.mockResolvedValue(new Map([[1, [
      planTask({ id: 10, taskNo: "D1", taskName: "Panel delivery", endDate: "2026-06-05", pctComplete: 0 }), // overdue
    ]]]));
  });

  it("counts all three overdue delivery sources and equals the list", async () => {
    const board = await getBoard(TODAY);
    const deliveries = await getDeliveriesProgram(TODAY);
    const overdueInList = deliveries.filter((r) => r.projectId === 1 && r.overdue).length;

    expect(overdueInList).toBe(3); // milestone + procurement + plan-task delivery
    expect(board.header.overdueDeliveries).toBe(overdueInList);
    expect(board.rows[0].overdueDeliveryCount).toBe(overdueInList);
  });

  it("derives the Next-delivery column from the earliest still-open row", async () => {
    const board = await getBoard(TODAY);
    // Earliest open by date: Grid milestone (2026-06-01).
    expect(board.rows[0].nextDelivery?.label).toBe("Grid");
  });
});

describe("board Eng/Quality use the real module when present (C2)", () => {
  it("uses the Engineering module RAG (blocked → red) and Quality module RAG (critical → red)", async () => {
    repo.getEngStagesForProjects.mockResolvedValue([{ projectId: 1, status: "blocked" }]);
    repo.getSnagsForProjects.mockResolvedValue([{ projectId: 1, severity: "critical", status: "open", dueDate: null }]);
    // Plan ENG/QUALITY tasks that would read GREEN — the module must win.
    repo.getPlanTasksForProjects.mockResolvedValue(new Map([[1, [
      planTask({ taskNo: "E1", workstream: "ENG", pctComplete: 1, expectedPctComplete: 1 }),
      planTask({ taskNo: "Q1", workstream: "QUALITY", pctComplete: 1, expectedPctComplete: 1 }),
    ]]]));

    const board = await getBoard(TODAY);
    expect(board.rows[0].engineering.rag).toBe("red");
    expect(board.rows[0].engineering.total).toBe(1); // one stage, not the plan task
    expect(board.rows[0].quality.rag).toBe("red");
    expect(board.rows[0].quality.total).toBe(1);     // one snag
  });
});

describe("board Eng/Quality fall back to the plan rollup when the module is empty (C2)", () => {
  it("uses the plan ENG workstream rollup and shows no QA signal when there is none", async () => {
    repo.getPlanTasksForProjects.mockResolvedValue(new Map([[1, [
      planTask({ taskNo: "E1", workstream: "ENG", pctComplete: 0.1, expectedPctComplete: 0.9 }),
    ]]]));

    const board = await getBoard(TODAY);
    expect(board.rows[0].engineering.hasPlan).toBe(true);
    expect(board.rows[0].engineering.rag).toBe("red"); // behind plan (10 vs 90)
    expect(board.rows[0].quality.hasPlan).toBe(false);
    expect(board.rows[0].quality.rag).toBeNull();
  });
});

describe("payload composition shape", () => {
  it("getBoard returns { header, rows } with the expected row fields", async () => {
    const board = await getBoard(TODAY);
    expect(board).toHaveProperty("header");
    expect(Array.isArray(board.rows)).toBe(true);
    const row = board.rows[0];
    for (const k of ["projectId", "projectName", "schedule", "nextDelivery", "overdueDeliveryCount", "installers", "engineering", "quality", "flags"]) {
      expect(row).toHaveProperty(k);
    }
  });

  it("getProjectDetail returns the detail payload with a deliveries block", async () => {
    const detail = await getProjectDetail(1, TODAY);
    expect(detail).not.toBeNull();
    expect(detail!.deliveries).toHaveProperty("tasks");
    expect(detail!.engineering).toBeDefined();
    expect(detail!.quality).toBeDefined();
  });
});
