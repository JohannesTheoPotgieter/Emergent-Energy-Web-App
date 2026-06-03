import { describe, expect, it } from "vitest";
import {
  computeReschedule,
  type RescheduleInputTask,
  type RescheduleDep,
} from "../../../server/lib/reschedule-engine";

const task = (
  id: number,
  start: string,
  end: string,
  dur: number,
  isFixed = false,
): RescheduleInputTask => ({
  id,
  taskNo: `T${id}`,
  name: `Task ${id}`,
  startDate: start,
  endDate: end,
  durationDays: dur,
  isFixed,
});

// Jan 2026: 5=Mon 6=Tue 7=Wed 8=Thu 9=Fri 10=Sat 11=Sun 12=Mon. No holidays.
describe("reschedule engine", () => {
  it("reflows FS successors after their predecessor (SA working days)", () => {
    const tasks = [
      task(1, "2026-01-05", "2026-01-06", 2), // root anchor (no preds)
      task(2, "2026-01-05", "2026-01-05", 1),
      task(3, "2026-01-05", "2026-01-05", 1),
    ];
    const deps: RescheduleDep[] = [
      { predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];
    const { changes, hasCircularDependency } = computeReschedule(tasks, deps);
    expect(hasCircularDependency).toBe(false);
    const c2 = changes.find((c) => c.id === 2)!;
    const c3 = changes.find((c) => c.id === 3)!;
    expect(c2.newStart).toBe("2026-01-07");
    expect(c2.newEnd).toBe("2026-01-07");
    expect(c3.newStart).toBe("2026-01-08");
    expect(c3.newEnd).toBe("2026-01-08");
    // Root (no predecessors) is never moved.
    expect(changes.find((c) => c.id === 1)).toBeUndefined();
  });

  it("never moves a fixed (manual) task; successors schedule from it", () => {
    const tasks = [
      task(1, "2026-01-05", "2026-01-06", 2),
      task(2, "2026-01-05", "2026-01-05", 1, true), // FIXED — anchored at Jan 5
      task(3, "2026-01-05", "2026-01-05", 1),
    ];
    const deps: RescheduleDep[] = [
      { predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { predecessorTaskId: 2, successorTaskId: 3, dependencyType: "FS", lagDays: 0 },
    ];
    const { changes } = computeReschedule(tasks, deps);
    expect(changes.find((c) => c.id === 2)).toBeUndefined(); // fixed, unchanged
    expect(changes.find((c) => c.id === 3)!.newStart).toBe("2026-01-06");
  });

  it("skips weekends — FS across Friday lands on Monday", () => {
    const tasks = [
      task(1, "2026-01-09", "2026-01-09", 1), // Friday root
      task(2, "2026-01-05", "2026-01-05", 1),
    ];
    const deps: RescheduleDep[] = [
      { predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
    ];
    const { changes } = computeReschedule(tasks, deps);
    expect(changes.find((c) => c.id === 2)!.newStart).toBe("2026-01-12");
  });

  it("honours SS dependencies (successor starts with predecessor + lag)", () => {
    const tasks = [
      task(1, "2026-01-05", "2026-01-08", 4),
      task(2, "2026-01-12", "2026-01-12", 1),
    ];
    const deps: RescheduleDep[] = [
      { predecessorTaskId: 1, successorTaskId: 2, dependencyType: "SS", lagDays: 0 },
    ];
    const { changes } = computeReschedule(tasks, deps);
    expect(changes.find((c) => c.id === 2)!.newStart).toBe("2026-01-05");
  });

  it("detects circular dependencies and proposes no changes", () => {
    const tasks = [task(1, "2026-01-05", "2026-01-05", 1), task(2, "2026-01-05", "2026-01-05", 1)];
    const deps: RescheduleDep[] = [
      { predecessorTaskId: 1, successorTaskId: 2, dependencyType: "FS", lagDays: 0 },
      { predecessorTaskId: 2, successorTaskId: 1, dependencyType: "FS", lagDays: 0 },
    ];
    const { hasCircularDependency, changes } = computeReschedule(tasks, deps);
    expect(hasCircularDependency).toBe(true);
    expect(changes).toEqual([]);
  });
});
