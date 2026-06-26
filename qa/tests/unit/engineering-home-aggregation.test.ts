import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dueBucket,
  summarizeEngineeringHome,
  type EngineeringHomeInput,
} from "../../../server/lib/engineering/home-aggregation";

/**
 * Pure Engineering Home aggregation — built on the spine (work_items + phase
 * read-only). Deterministic via an injected `today`. Covers the slice filters
 * (site / engineer) and the hide-completed default.
 */

const TODAY = "2026-06-22";

describe("engineering home — date helpers", () => {
  it("addDaysIso advances ISO dates across month boundaries", () => {
    expect(addDaysIso("2026-06-22", 6)).toBe("2026-06-28");
    expect(addDaysIso("2026-06-28", 3)).toBe("2026-07-01");
  });

  it("dueBucket classifies relative to today", () => {
    expect(dueBucket(null, TODAY)).toBe("none");
    expect(dueBucket("2026-06-20", TODAY)).toBe("overdue");
    expect(dueBucket("2026-06-22", TODAY)).toBe("today");
    expect(dueBucket("2026-06-26", TODAY)).toBe("this_week");
    expect(dueBucket("2026-06-28", TODAY)).toBe("this_week"); // inclusive +6
    expect(dueBucket("2026-06-29", TODAY)).toBe("later");
  });
});

/** Shared spine fixture. Alpha (Construction, active window) + Beta (Planning,
 *  active window) + Gamma (Done, OUT of active window). */
function baseInput(overrides: Partial<EngineeringHomeInput> = {}): EngineeringHomeInput {
  return {
    today: TODAY,
    myUserId: 7,
    myAssignedTaskIds: new Set<number>([3]),
    projects: [
      { id: 1, projectName: "Alpha", phaseCode: "S06_CONSTRUCTION" },
      { id: 2, projectName: "Beta", phaseCode: "S04_PLANNING" },
      { id: 3, projectName: "Gamma", phaseCode: "S_DONE" },
    ],
    tasks: [
      { id: 1, projectId: 1, status: "in_progress", endDate: "2026-06-20", ownerUserId: 7, ownerName: "Grace", title: "Overdue IFC", priority: "High" },
      { id: 2, projectId: 1, status: "complete", endDate: "2026-06-01", ownerUserId: 8, ownerName: "Bob", title: "Done", priority: null },
      { id: 3, projectId: 2, status: "to_do", endDate: "2026-06-22", ownerUserId: 8, ownerName: "Bob", title: "Due today (assigned to me)", priority: "Med" },
      { id: 4, projectId: 2, status: "in_progress", endDate: "2026-06-26", ownerUserId: 9, ownerName: "Alice", title: "This week", priority: null },
      { id: 5, projectId: 1, status: "not_started", endDate: null, ownerUserId: 7, ownerName: "Grace", title: "No due date (mine)", priority: "Low" },
      { id: 6, projectId: 3, status: "in_progress", endDate: "2026-06-20", ownerUserId: 9, ownerName: "Alice", title: "Work on a Done project", priority: null },
    ],
    ...overrides,
  };
}

describe("summarizeEngineeringHome — includeCompleted=true (full set)", () => {
  // With completed work + Done projects included, behaviour matches the
  // original program-wide view (plus the Gamma/Done project).
  const result = summarizeEngineeringHome(baseInput({ filters: { includeCompleted: true } }));

  it("computes overview metrics across all projects", () => {
    expect(result.metrics).toEqual({
      activeProjects: 3, // Alpha, Beta, Gamma all have tasks
      openTasks: 5, // T1, T3, T4, T5, T6 (T2 complete)
      dueThisWeek: 2, // T3 today + T4 this_week
      overdue: 2, // T1 + T6
    });
  });

  it("includes the Done project in the portfolio with done-counted progress", () => {
    const alpha = result.portfolio.find((p) => p.projectId === 1);
    expect(alpha).toMatchObject({ phaseLabel: "Construction", open: 2, overdue: 1, progress: 33 });
    expect(result.portfolio.some((p) => p.projectId === 3)).toBe(true); // Gamma/Done present
  });

  it("lists every distinct owner alphabetically", () => {
    expect(result.owners).toEqual([
      { id: 9, name: "Alice" },
      { id: 8, name: "Bob" },
      { id: 7, name: "Grace" },
    ]);
  });
});

describe("summarizeEngineeringHome — default hide-completed (no filters)", () => {
  // Default: includeCompleted is false → completed tasks AND Done-stage
  // projects drop out.
  const result = summarizeEngineeringHome(baseInput());

  it("excludes completed tasks from the per-project tally (progress recomputed)", () => {
    const alpha = result.portfolio.find((p) => p.projectId === 1);
    // T2 (complete) is gone, so Alpha = 2 open tasks, 0 done → progress 0.
    expect(alpha).toMatchObject({ open: 2, overdue: 1, progress: 0 });
  });

  it("drops Done-stage projects from the portfolio", () => {
    expect(result.portfolio.some((p) => p.projectId === 3)).toBe(false);
  });

  it("still exposes the full owners list (computed pre-filter)", () => {
    expect(result.owners.map((o) => o.name)).toEqual(["Alice", "Bob", "Grace"]);
  });

  it("counts open work including tasks on Done-stage projects in the metrics", () => {
    // Metrics aggregate every in-scope open task; T6 lives on a Done project
    // (hidden from the portfolio) but is still open work for the function.
    expect(result.metrics.openTasks).toBe(5);
    expect(result.metrics.overdue).toBe(2);
  });
});

describe("summarizeEngineeringHome — site (project) filter", () => {
  const result = summarizeEngineeringHome(baseInput({ filters: { projectIds: [2] } }));

  it("scopes metrics + portfolio to the selected site", () => {
    expect(result.metrics.activeProjects).toBe(1);
    expect(result.metrics.openTasks).toBe(2); // T3 + T4 on Beta
    expect(result.portfolio.map((p) => p.projectId)).toEqual([2]);
  });

  it("scopes My Work to the selected site", () => {
    // T3 (assigned to me) is on Beta and survives; T1/T5 (mine, on Alpha) drop.
    expect(result.myWork.map((t) => t.id)).toEqual([3]);
  });
});

describe("summarizeEngineeringHome — engineer (owner) filter", () => {
  const result = summarizeEngineeringHome(baseInput({ filters: { ownerUserId: 7 } }));

  it("scopes metrics + portfolio + My Work to the chosen engineer", () => {
    // Grace (7) owns T1 (Alpha, overdue) + T5 (Alpha, no date). Both open.
    expect(result.metrics.openTasks).toBe(2);
    expect(result.metrics.overdue).toBe(1);
    expect(result.portfolio.map((p) => p.projectId)).toEqual([1]);
    expect(result.myWork.map((t) => t.id)).toEqual([1, 5]);
  });

  it("keeps the owners dropdown complete despite the owner filter", () => {
    expect(result.owners.map((o) => o.name)).toEqual(["Alice", "Bob", "Grace"]);
  });
});

describe("summarizeEngineeringHome — My Work shape", () => {
  const result = summarizeEngineeringHome(baseInput({ filters: { includeCompleted: true } }));

  it("scopes my work to owned or assigned open tasks, ordered by due", () => {
    expect(result.myWork.map((t) => ({ id: t.id, due: t.due }))).toEqual([
      { id: 1, due: "overdue" }, // owned
      { id: 3, due: "today" }, // assigned
      { id: 5, due: "none" }, // owned, no due date
    ]);
    // T2 (complete) and T4/T6 (not mine) are excluded.
    expect(result.myWork.some((t) => t.id === 2 || t.id === 4 || t.id === 6)).toBe(false);
  });
});
