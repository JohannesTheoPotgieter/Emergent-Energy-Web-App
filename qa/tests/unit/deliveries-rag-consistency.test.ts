// Guards the Deliveries program RAG being CONSISTENT across sources. Milestone
// and plan-task delivery rows colour by their target date (deliveryRag); a
// procurement order colours by the lead-time planner (willMakeIt). When the
// planner can't assess (no lead time / not ordered) the order must fall back to
// the SAME target-date RAG — so an overdue order still reads red rather than
// greying out and diverging from the other two sources.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { repo } = vi.hoisted(() => ({
  repo: {
    getActiveProjects: vi.fn(),
    getDeliveryMilestonesForProjects: vi.fn(),
    getProcurementDeliveriesForProjects: vi.fn(),
    getPlanTasksForProjects: vi.fn(),
  },
}));
vi.mock("../../../server/repositories/execution-board-repository", () => ({ executionBoardRepository: repo }));

import { getDeliveriesProgram } from "../../../server/services/execution-board-service";

const TODAY = new Date("2026-06-24T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  repo.getActiveProjects.mockResolvedValue([{ id: 1, projectName: "Coega BESS" }]);
  repo.getDeliveryMilestonesForProjects.mockResolvedValue([]);
  repo.getPlanTasksForProjects.mockResolvedValue(new Map());
});

function procurement(over: Record<string, unknown>) {
  return {
    id: 5, projectId: 1, title: "Inverters", status: "open", requiredDate: null,
    leadTimeDays: null, orderDate: null, deliveryExpectedDate: null, deliveryActualDate: null,
    deliveryStatus: null, isLongLead: false, linkedWorkItemId: null,
    taskNo: null, taskTitle: null, taskStartDate: null, taskEndDate: null, ...over,
  };
}

describe("getDeliveriesProgram — RAG consistency across sources", () => {
  it("an order with no lead time but an overdue needed date reads red (target-date fallback), not grey", async () => {
    // needed a week ago, no lead time / not ordered → planner returns null; the
    // fallback target-date RAG must colour it red like a milestone/task row would.
    repo.getProcurementDeliveriesForProjects.mockResolvedValue([
      procurement({ taskStartDate: "2026-06-17" }),
    ]);
    const rows = await getDeliveriesProgram(TODAY);
    const order = rows.find((r) => r.source === "procurement");
    expect(order).toBeDefined();
    expect(order!.willMakeIt).toBeNull(); // planner genuinely couldn't assess
    expect(order!.rag).toBe("red");       // …but the row still colours red
    expect(order!.overdue).toBe(true);
  });

  it("an order with lead-time data still uses the planner's will-make-it RAG", async () => {
    // ordered with ample slack → planner says green; fallback is not used.
    repo.getProcurementDeliveriesForProjects.mockResolvedValue([
      procurement({ taskStartDate: "2026-09-01", leadTimeDays: 30, orderDate: "2026-06-20" }),
    ]);
    const rows = await getDeliveriesProgram(TODAY);
    const order = rows.find((r) => r.source === "procurement");
    expect(order!.willMakeIt).toBe("green");
    expect(order!.rag).toBe("green");
  });

  it("a future order with no lead time reads green via the same fallback", async () => {
    repo.getProcurementDeliveriesForProjects.mockResolvedValue([
      procurement({ taskStartDate: "2026-09-01" }),
    ]);
    const rows = await getDeliveriesProgram(TODAY);
    const order = rows.find((r) => r.source === "procurement");
    expect(order!.willMakeIt).toBeNull();
    expect(order!.rag).toBe("green");
    expect(order!.overdue).toBe(false);
  });
});
