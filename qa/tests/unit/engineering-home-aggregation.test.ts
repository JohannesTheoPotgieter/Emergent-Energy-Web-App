import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dueBucket,
  summarizeEngineeringHome,
  type EngineeringHomeInput,
} from "../../../server/lib/engineering/home-aggregation";

/**
 * Pure Engineering Home aggregation — built on the spine (work_items + phase
 * read-only). Deterministic via an injected `today`.
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

describe("summarizeEngineeringHome", () => {
  const input: EngineeringHomeInput = {
    today: TODAY,
    myUserId: 7,
    myAssignedTaskIds: new Set<number>([3]),
    projects: [
      { id: 1, projectName: "Alpha", phaseCode: "S06_CONSTRUCTION" },
      { id: 2, projectName: "Beta", phaseCode: "S04_PLANNING" },
    ],
    tasks: [
      { id: 1, projectId: 1, status: "in_progress", endDate: "2026-06-20", ownerUserId: 7, title: "Overdue IFC", priority: "High" },
      { id: 2, projectId: 1, status: "complete", endDate: "2026-06-01", ownerUserId: 8, title: "Done", priority: null },
      { id: 3, projectId: 2, status: "to_do", endDate: "2026-06-22", ownerUserId: 8, title: "Due today (assigned to me)", priority: "Med" },
      { id: 4, projectId: 2, status: "in_progress", endDate: "2026-06-26", ownerUserId: 9, title: "This week", priority: null },
      { id: 5, projectId: 1, status: "not_started", endDate: null, ownerUserId: 7, title: "No due date (mine)", priority: "Low" },
    ],
  };

  const result = summarizeEngineeringHome(input);

  it("computes overview metrics", () => {
    expect(result.metrics).toEqual({
      activeProjects: 2,
      openTasks: 4, // T1, T3, T4, T5 (T2 is complete)
      dueThisWeek: 2, // T3 today + T4 this_week
      overdue: 1, // T1
    });
  });

  it("builds the portfolio with read-only phase labels, sorted by overdue then open", () => {
    expect(result.portfolio).toEqual([
      {
        projectId: 1,
        projectName: "Alpha",
        phaseCode: "S06_CONSTRUCTION",
        phaseLabel: "Construction",
        open: 2, // T1, T5
        overdue: 1, // T1
        progress: 33, // 1 done / 3 total
      },
      {
        projectId: 2,
        projectName: "Beta",
        phaseCode: "S04_PLANNING",
        phaseLabel: "Planning",
        open: 2, // T3, T4
        overdue: 0,
        progress: 0,
      },
    ]);
  });

  it("scopes my work to owned or assigned open tasks, ordered by due", () => {
    expect(result.myWork.map((t) => ({ id: t.id, due: t.due }))).toEqual([
      { id: 1, due: "overdue" }, // owned
      { id: 3, due: "today" }, // assigned
      { id: 5, due: "none" }, // owned, no due date
    ]);
    // T2 (complete) and T4 (not mine) are excluded.
    expect(result.myWork.some((t) => t.id === 2 || t.id === 4)).toBe(false);
  });
});
