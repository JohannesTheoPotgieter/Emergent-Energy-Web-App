import { describe, expect, it } from "vitest";
import { calculateCPM, type CPMDependency } from "../../../server/cpmEngine";

type InputTask = {
  id: number;
  taskNo: string;
  name: string;
  startDate: string;
  endDate: string;
  type: string;
};

function baseTask(task: InputTask) {
  return {
    ...task,
    percentComplete: 0,
  };
}

describe("CPM engine", () => {
  it("forward pass computes earliest start/finish for a simple 3-task chain", () => {
    const tasks = [
      baseTask({ id: 1, taskNo: "T1", name: "A", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 2, taskNo: "T2", name: "B", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 3, taskNo: "T3", name: "C", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
    ];

    const deps: CPMDependency[] = [
      { id: 11, predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 12, predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    const result = calculateCPM(tasks, deps);
    const t1 = result.tasks.find(t => t.id === 1)!;
    const t2 = result.tasks.find(t => t.id === 2)!;
    const t3 = result.tasks.find(t => t.id === 3)!;

    expect(result.hasCircularDependency).toBe(false);
    expect(t1.es).toBe(0);
    expect(t1.ef).toBe(2);
    expect(t2.es).toBe(2);
    expect(t2.ef).toBe(4);
    expect(t3.es).toBe(4);
    expect(t3.ef).toBe(6);
    expect(result.projectFinish).toBe(6);
  });

  it("backward pass computes latest start/finish correctly", () => {
    const tasks = [
      baseTask({ id: 1, taskNo: "T1", name: "A", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 2, taskNo: "T2", name: "B", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 3, taskNo: "T3", name: "C", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
    ];

    const deps: CPMDependency[] = [
      { id: 21, predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 22, predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    const result = calculateCPM(tasks, deps);
    const t1 = result.tasks.find(t => t.id === 1)!;
    const t2 = result.tasks.find(t => t.id === 2)!;
    const t3 = result.tasks.find(t => t.id === 3)!;

    expect(t3.lf).toBe(6);
    expect(t3.ls).toBe(4);
    expect(t2.lf).toBe(4);
    expect(t2.ls).toBe(2);
    expect(t1.lf).toBe(2);
    expect(t1.ls).toBe(0);
  });

  it("computes zero float for tasks on the critical path", () => {
    const tasks = [
      baseTask({ id: 1, taskNo: "T1", name: "A", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 2, taskNo: "T2", name: "B", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
      baseTask({ id: 3, taskNo: "T3", name: "C", startDate: "2026-01-05", endDate: "2026-01-06", type: "task" }),
    ];

    const deps: CPMDependency[] = [
      { id: 31, predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 32, predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    const result = calculateCPM(tasks, deps);

    expect(result.criticalPath).toEqual([1, 2, 3]);
    for (const task of result.tasks) {
      expect(task.slack).toBe(0);
      expect(task.isCritical).toBe(true);
    }
  });

  it("enforces dependency resolution so a task starts only after all predecessors finish", () => {
    const tasks = [
      baseTask({ id: 1, taskNo: "T1", name: "A", startDate: "2026-01-05", endDate: "2026-01-05", type: "task" }),
      baseTask({ id: 2, taskNo: "T2", name: "B", startDate: "2026-01-05", endDate: "2026-01-07", type: "task" }),
      baseTask({ id: 3, taskNo: "T3", name: "C", startDate: "2026-01-05", endDate: "2026-01-05", type: "task" }),
    ];

    const deps: CPMDependency[] = [
      { id: 41, predecessorTaskId: 1, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
      { id: 42, predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    const result = calculateCPM(tasks, deps);
    const a = result.tasks.find(t => t.id === 1)!;
    const b = result.tasks.find(t => t.id === 2)!;
    const c = result.tasks.find(t => t.id === 3)!;

    expect(a.ef).toBe(1);
    expect(b.ef).toBe(3);
    expect(c.es).toBe(3);
    expect(c.es).toBeGreaterThanOrEqual(a.ef);
    expect(c.es).toBeGreaterThanOrEqual(b.ef);
  });

  it("detects circular dependencies and returns a meaningful error message", () => {
    const tasks = [
      baseTask({ id: 1, taskNo: "T1", name: "A", startDate: "2026-01-05", endDate: "2026-01-05", type: "task" }),
      baseTask({ id: 2, taskNo: "T2", name: "B", startDate: "2026-01-05", endDate: "2026-01-05", type: "task" }),
    ];

    const deps: CPMDependency[] = [
      { id: 51, predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 52, predecessorTaskId: 2, successorTaskId: 1, dependencyType: "FS", lagDays: 0 },
    ];

    const result = calculateCPM(tasks, deps);

    expect(result.hasCircularDependency).toBe(true);
    expect(result.warnings).toContain("Circular dependency detected in task dependencies");
    expect(result.projectFinish).toBe(0);
  });
});
