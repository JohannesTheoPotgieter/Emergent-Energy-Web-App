import { describe, it, expect } from "vitest";
import type { ProjectDeliveryMilestone } from "@shared/schema";
import type {
  EngStageRow,
  SnagRow,
  ProcurementDeliveryRow,
} from "../../../server/repositories/execution-board-repository";
import {
  computeScheduleSnapshot,
  selectNextTask,
  selectNextDelivery,
  deliveryRag,
  summarizeEngineering,
  summarizeQuality,
  summarizeWorkstream,
  computeCriticalPath,
  parsePlanDate,
  startOfDay,
  type PlanTask,
} from "../../../server/services/execution-board-math";

const TODAY = startOfDay(new Date(2026, 5, 15)); // 2026-06-15

function task(o: Partial<PlanTask>): PlanTask {
  return {
    taskNo: null,
    taskName: "Task",
    phase: null,
    workstream: null,
    startDate: null,
    endDate: null,
    durationDays: null,
    actualStartDate: null,
    actualEndDate: null,
    pctComplete: null,
    expectedPctComplete: null,
    comment: null,
    isMilestone: false,
    parentTaskNo: null,
    ...o,
  };
}

function milestone(o: Partial<ProjectDeliveryMilestone>): ProjectDeliveryMilestone {
  return {
    id: 1,
    projectId: 1,
    milestoneName: "M",
    plannedDate: null,
    actualDate: null,
    status: "planned",
    blocker: null,
    ...o,
  } as ProjectDeliveryMilestone;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDays(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return iso(d);
}

describe("computeScheduleSnapshot", () => {
  it("returns no-plan for empty task list", () => {
    const s = computeScheduleSnapshot([]);
    expect(s.hasPlan).toBe(false);
    expect(s.rag).toBeNull();
    expect(s.actualPct).toBeNull();
  });

  it("excludes parent rows and duration-weights leaf pct", () => {
    const tasks = [
      task({ taskNo: "1", durationDays: 999, pctComplete: 0, expectedPctComplete: 0 }), // parent (excluded)
      task({ taskNo: "1.1", parentTaskNo: "1", durationDays: 10, pctComplete: 100, expectedPctComplete: 100 }),
      task({ taskNo: "1.2", parentTaskNo: "1", durationDays: 10, pctComplete: 0, expectedPctComplete: 50 }),
    ];
    const s = computeScheduleSnapshot(tasks);
    expect(s.leafCount).toBe(2);
    expect(s.actualPct).toBe(50); // (100*10 + 0*10) / 20
    expect(s.expectedPct).toBe(75); // (100*10 + 50*10) / 20
    expect(s.variance).toBe(-25);
    expect(s.rag).toBe("red"); // delta -25 < -15
  });

  it("treats a flat list (no parents) as all leaves and defaults null duration to 1", () => {
    const tasks = [
      task({ taskNo: "1", pctComplete: 60, expectedPctComplete: 62 }),
      task({ taskNo: "2", pctComplete: 60, expectedPctComplete: 62 }),
    ];
    const s = computeScheduleSnapshot(tasks);
    expect(s.leafCount).toBe(2);
    expect(s.actualPct).toBe(60);
    expect(s.expectedPct).toBe(62);
    expect(s.rag).toBe("green"); // delta -2 ≥ -5
  });

  it("amber band for -5..-15 variance", () => {
    const s = computeScheduleSnapshot([task({ taskNo: "1", pctComplete: 50, expectedPctComplete: 60 })]);
    expect(s.variance).toBe(-10);
    expect(s.rag).toBe("amber");
  });
});

describe("selectNextTask", () => {
  it("picks the earliest incomplete leaf starting within the window", () => {
    const tasks = [
      task({ taskNo: "1", parentTaskNo: null, startDate: plusDays(2), taskName: "Parent has child" }),
      task({ taskNo: "1.1", parentTaskNo: "1", startDate: plusDays(5), pctComplete: 0, taskName: "Switchboard" }),
      task({ taskNo: "1.2", parentTaskNo: "1", startDate: plusDays(3), pctComplete: 0, taskName: "Earliest leaf" }),
      task({ taskNo: "1.3", parentTaskNo: "1", startDate: plusDays(1), pctComplete: 100, taskName: "Done (excluded)" }),
      task({ taskNo: "1.4", parentTaskNo: "1", startDate: plusDays(40), pctComplete: 0, taskName: "Out of window" }),
    ];
    const next = selectNextTask(tasks, TODAY, 14);
    expect(next?.taskName).toBe("Earliest leaf");
    expect(next?.taskNo).toBe("1.2");
  });

  it("returns null when nothing starts in the window", () => {
    const tasks = [task({ taskNo: "1", startDate: plusDays(40), pctComplete: 0 })];
    expect(selectNextTask(tasks, TODAY, 14)).toBeNull();
  });
});

describe("deliveryRag", () => {
  it("flags overdue red, near amber, far green, done green", () => {
    expect(deliveryRag(startOfDay(new Date(plusDays(-1))), TODAY, false)).toBe("red");
    expect(deliveryRag(startOfDay(new Date(plusDays(5))), TODAY, false)).toBe("amber");
    expect(deliveryRag(startOfDay(new Date(plusDays(30))), TODAY, false)).toBe("green");
    expect(deliveryRag(startOfDay(new Date(plusDays(-5))), TODAY, true)).toBe("green");
    expect(deliveryRag(null, TODAY, false)).toBeNull();
  });
});

describe("selectNextDelivery", () => {
  it("returns the earliest open delivery and counts overdue ones", () => {
    const milestones = [
      milestone({ milestoneName: "Switchgear", plannedDate: plusDays(10) }),
      milestone({ milestoneName: "Done milestone", plannedDate: plusDays(2), actualDate: plusDays(1) }),
      milestone({ milestoneName: "Overdue meter", plannedDate: plusDays(-3) }),
    ];
    const procurement: ProcurementDeliveryRow[] = [
      { id: 1, projectId: 1, title: "Container", status: "ordered", requiredDate: plusDays(5), supplierId: 9, progressPercent: 20 },
    ];
    const res = selectNextDelivery(milestones, procurement, TODAY);
    expect(res.overdueCount).toBe(1); // the overdue meter
    expect(res.next?.label).toBe("Overdue meter"); // earliest open (−3 days)
    expect(res.next?.rag).toBe("red");
  });

  it("ignores completed milestones", () => {
    const res = selectNextDelivery(
      [milestone({ milestoneName: "Done", plannedDate: plusDays(1), status: "complete" })],
      [],
      TODAY,
    );
    expect(res.next).toBeNull();
    expect(res.overdueCount).toBe(0);
  });
});

describe("summarizeEngineering", () => {
  const stage = (status: string): EngStageRow => ({ projectId: 1, status });
  it("is red when any stage is blocked", () => {
    expect(summarizeEngineering([stage("in_progress"), stage("blocked")], 3).rag).toBe("red");
  });
  it("is green when all stages complete", () => {
    expect(summarizeEngineering([stage("complete"), stage("complete")], 0).rag).toBe("green");
  });
  it("is amber when in progress, none blocked", () => {
    expect(summarizeEngineering([stage("in_progress"), stage("complete")], 2).rag).toBe("amber");
  });
  it("is null when there are no stages", () => {
    expect(summarizeEngineering([], 0).rag).toBeNull();
  });
});

describe("summarizeQuality", () => {
  const snag = (severity: string, status = "open", dueDate: string | null = null): SnagRow => ({
    projectId: 1,
    severity,
    status,
    dueDate,
  });
  it("is red with an open critical snag", () => {
    const q = summarizeQuality([snag("critical"), snag("minor")], true, TODAY);
    expect(q.rag).toBe("red");
    expect(q.critical).toBe(1);
    expect(q.openTotal).toBe(2);
  });
  it("is amber with an open major or an overdue snag", () => {
    expect(summarizeQuality([snag("major")], true, TODAY).rag).toBe("amber");
    expect(summarizeQuality([snag("minor", "open", plusDays(-2))], true, TODAY).overdue).toBe(1);
    expect(summarizeQuality([snag("minor", "open", plusDays(-2))], true, TODAY).rag).toBe("amber");
  });
  it("excludes closed snags from the open count and is green when clean", () => {
    const q = summarizeQuality([snag("critical", "closed"), snag("major", "resolved")], true, TODAY);
    expect(q.openTotal).toBe(0);
    expect(q.rag).toBe("green");
  });
  it("is null when there are no snags and no QCP", () => {
    expect(summarizeQuality([], false, TODAY).rag).toBeNull();
  });
});

describe("summarizeWorkstream", () => {
  it("has no plan when there are no tasks", () => {
    const s = summarizeWorkstream([]);
    expect(s.hasPlan).toBe(false);
    expect(s.total).toBe(0);
    expect(s.rag).toBeNull();
  });
  it("counts leaf tasks by completion and excludes summary parents", () => {
    const s = summarizeWorkstream([
      task({ taskNo: "1", durationDays: 999, pctComplete: 100, expectedPctComplete: 100 }), // parent (excluded)
      task({ taskNo: "1.1", parentTaskNo: "1", durationDays: 10, pctComplete: 100, expectedPctComplete: 100 }),
      task({ taskNo: "1.2", parentTaskNo: "1", durationDays: 10, pctComplete: 40, expectedPctComplete: 50 }),
      task({ taskNo: "1.3", parentTaskNo: "1", durationDays: 10, pctComplete: 0, expectedPctComplete: 20 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.complete).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.notStarted).toBe(1);
    expect(s.hasPlan).toBe(true);
  });
  it("derives the RAG from schedule variance (behind plan → red)", () => {
    const s = summarizeWorkstream([task({ taskNo: "1", pctComplete: 10, expectedPctComplete: 90 })]);
    expect(s.rag).toBe("red");
  });
});

describe("computeCriticalPath", () => {
  it("returns an empty path when there are no dated leaf tasks", () => {
    const r = computeCriticalPath([task({ taskNo: "1" })]); // no dates
    expect(r.criticalTaskNos).toEqual([]);
    expect(r.projectFinish).toBeNull();
    expect(r.datedTaskCount).toBe(0);
  });

  it("picks the longest-duration date chain ending at the project finish, excluding parents", () => {
    const tasks = [
      task({ taskNo: "0", startDate: "2026-01-01", endDate: "2026-01-25" }), // summary parent (excluded)
      task({ taskNo: "A", parentTaskNo: "0", startDate: "2026-01-01", endDate: "2026-01-10" }),
      task({ taskNo: "B", parentTaskNo: "0", startDate: "2026-01-11", endDate: "2026-01-20" }),
      task({ taskNo: "C", parentTaskNo: "0", startDate: "2026-01-01", endDate: "2026-01-05" }),
      task({ taskNo: "D", parentTaskNo: "0", startDate: "2026-01-21", endDate: "2026-01-25" }),
      task({ taskNo: "E", parentTaskNo: "0", startDate: "2026-01-06", endDate: "2026-01-09" }),
    ];
    const r = computeCriticalPath(tasks);
    expect(r.criticalTaskNos).toEqual(["A", "B", "D"]);
    expect(r.criticalTaskNos).not.toContain("0"); // parent excluded
    expect(r.projectStart).toBe("2026-01-01");
    expect(r.projectFinish).toBe("2026-01-25");
    expect(r.spanDays).toBe(25);
    expect(r.datedTaskCount).toBe(5);
    expect(r.chain[0].taskNo).toBe("A");
    expect(r.chain[r.chain.length - 1].taskNo).toBe("D");
  });

  it("falls back to actual dates when planned dates are missing", () => {
    const r = computeCriticalPath([
      task({ taskNo: "X", actualStartDate: "2026-02-01", actualEndDate: "2026-02-05" }),
    ]);
    expect(r.criticalTaskNos).toEqual(["X"]);
    expect(r.spanDays).toBe(5);
  });
});

describe("parsePlanDate", () => {
  it("parses ISO and dd/mm/yyyy, rejects junk", () => {
    expect(parsePlanDate("2026-03-09")?.getFullYear()).toBe(2026);
    expect(parsePlanDate("09/03/2026")?.getMonth()).toBe(2); // March
    expect(parsePlanDate("")).toBeNull();
    expect(parsePlanDate(null)).toBeNull();
    expect(parsePlanDate("not a date")).toBeNull();
  });
});
