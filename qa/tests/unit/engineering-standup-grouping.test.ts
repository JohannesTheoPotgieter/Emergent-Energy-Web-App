import { describe, expect, it } from "vitest";
import { bucketEngineeringStandupTasks, classifyStandupGroup, type StandupTaskLike } from "../../../shared/engineering-standup";

function task(overrides: Partial<StandupTaskLike> & { id: number }): StandupTaskLike {
  return {
    id: overrides.id,
    status: "TO DO",
    dueDate: null,
    ownerUserId: null,
    assigneeUserIds: null,
    assignees: null,
    ...overrides,
  };
}

describe("engineering standup grouping", () => {
  it("classifies overdue open work before other buckets", () => {
    const grouped = classifyStandupGroup(task({ id: 1, status: "IN PROGRESS", dueDate: "2026-03-15" }), "2026-03-16", 7);
    expect(grouped).toBe("overdue");
  });

  it("classifies due soon inside threshold", () => {
    const grouped = classifyStandupGroup(task({ id: 2, status: "TO DO", dueDate: "2026-03-20" }), "2026-03-16", 7);
    expect(grouped).toBe("dueSoon");
  });

  it("keeps on hold work in on-hold group", () => {
    const grouped = classifyStandupGroup(task({ id: 3, status: "HOLD", dueDate: "2026-03-20" }), "2026-03-16", 7);
    expect(grouped).toBe("onHold");
  });

  it("shows unassigned engineering items explicitly", () => {
    const grouped = bucketEngineeringStandupTasks([
      task({ id: 4, status: "TO DO", dueDate: null }),
    ], "2026-03-16", 7);

    expect(grouped.groups.unassigned.map((t) => t.id)).toEqual([4]);
    expect(grouped.assigneeCounts.unassigned).toBe(1);
  });

  it("includes multiple engineering work item types/statuses without dumping into everything else", () => {
    const grouped = bucketEngineeringStandupTasks([
      task({ id: 5, status: "IN PROGRESS", dueDate: null, ownerUserId: 10 }),
      task({ id: 6, status: "NEEDS APPROVAL", dueDate: null, ownerUserId: 10 }),
      task({ id: 7, status: "PROJECTS ASSISTANCE", dueDate: null, ownerUserId: 10 }),
    ], "2026-03-16", 7);

    expect(grouped.groups.inProgress.map((t) => t.id)).toEqual([5, 6, 7]);
    expect(grouped.groups.everythingElse).toHaveLength(0);
  });

  it("group counts match displayed item totals", () => {
    const grouped = bucketEngineeringStandupTasks([
      task({ id: 8, status: "IN PROGRESS", dueDate: "2026-03-14", ownerUserId: 1 }),
      task({ id: 9, status: "TO DO", dueDate: "2026-03-17", ownerUserId: 1 }),
      task({ id: 10, status: "HOLD", dueDate: null, ownerUserId: 1 }),
      task({ id: 11, status: "TO DO", dueDate: null }),
    ], "2026-03-16", 7);

    const total = Object.values(grouped.groups).reduce((sum, entries) => sum + entries.length, 0);
    expect(total).toBe(4);
    expect(grouped.groups.overdue).toHaveLength(1);
    expect(grouped.groups.dueSoon).toHaveLength(1);
    expect(grouped.groups.onHold).toHaveLength(1);
    expect(grouped.groups.unassigned).toHaveLength(1);
  });
});
