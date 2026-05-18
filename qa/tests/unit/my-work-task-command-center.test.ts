import { describe, expect, it } from "vitest";
import {
  buildTaskCommandCenterModel,
  taskProgressPercent,
  type MyWorkTaskRow,
} from "../../../client/src/components/priorities/MyWorkTasksList";

function makeTask(overrides: Partial<MyWorkTaskRow> = {}): MyWorkTaskRow {
  return {
    id: 1,
    title: "Task",
    description: null,
    status: "Not Started",
    priority: "normal",
    dueDate: null,
    startDate: null,
    projectId: null,
    projectName: null,
    ownerUserId: 10,
    ownerName: "Owner",
    workstream: "PERSONAL",
    source: "UI",
    taskCategory: null,
    bucket: "personal",
    percentComplete: 0,
    trackingRag: null,
    createdAt: "2026-05-01",
    updatedAt: "2026-05-01",
    ...overrides,
  };
}

describe("Task Command Center model", () => {
  const today = "2026-05-18";

  it("builds metrics and focus buckets from live task rows", () => {
    const model = buildTaskCommandCenterModel(
      [
        makeTask({ id: 1, dueDate: "2026-05-15", status: "Not Started" }),
        makeTask({ id: 2, dueDate: today, status: "In Progress", bucket: null, workstream: "PROJECT", projectId: 4, projectName: "Mondi" }),
        makeTask({ id: 3, dueDate: "2026-05-22", status: "Blocked", trackingRag: "red", bucket: null, workstream: "PROJECT", projectId: 5, projectName: "Coega" }),
        makeTask({ id: 4, dueDate: "2026-05-21", status: "Complete", percentComplete: 1 }),
      ],
      { today, query: "", focus: "all", sort: "dueDate" },
    );

    expect(model.metrics).toMatchObject({
      open: 3,
      overdue: 1,
      dueThisWeek: 3,
      inProgress: 1,
      blocked: 1,
      completed: 1,
      personal: 2,
      project: 2,
    });
    expect(model.focusBuckets.map((bucket) => [bucket.key, bucket.count])).toEqual([
      ["today_overdue", 2],
      ["blocked", 1],
      ["project", 2],
      ["personal", 2],
      ["completed", 1],
    ]);
  });

  it("filters by search and focus queue, then sorts due tasks before undated tasks", () => {
    const model = buildTaskCommandCenterModel(
      [
        makeTask({ id: 1, title: "Personal note", dueDate: null }),
        makeTask({ id: 2, title: "Coega O&M handover pack review", projectName: "Coega ph2", projectId: 22, bucket: null, workstream: "PROJECT", dueDate: "2026-05-20" }),
        makeTask({ id: 3, title: "Mondi QC hold points", projectName: "Mondi", projectId: 11, bucket: null, workstream: "PROJECT", dueDate: "2026-05-15" }),
      ],
      { today, query: "coega", focus: "project", sort: "dueDate" },
    );

    expect(model.visibleTasks.map((task) => task.id)).toEqual([2]);
  });

  it("normalizes task progress from either fractional or percentage values", () => {
    expect(taskProgressPercent(makeTask({ percentComplete: 0.9 }))).toBe(90);
    expect(taskProgressPercent(makeTask({ percentComplete: 90 }))).toBe(90);
    expect(taskProgressPercent(makeTask({ percentComplete: 1 }))).toBe(100);
  });
});
