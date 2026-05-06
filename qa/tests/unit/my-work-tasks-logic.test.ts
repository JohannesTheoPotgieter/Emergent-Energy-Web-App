import { describe, expect, it } from "vitest";
import { canReassignTask, compareTasksSmart, getTaskAssigneeNames, isTaskDueSoon, isTaskOverdue } from "@/pages/my-work-tasks-logic";

describe("my-work tasks logic", () => {
  it("deduplicates assignee names across resolved and text owners", () => {
    const names = getTaskAssigneeNames({
      status: "todo",
      _source: "operational",
      resolvedAssignees: [{ name: "Alex Doe" }],
      assignees: ["Alex Doe", "Taylor"],
      owners: ["Taylor"],
    });
    expect(names).toEqual(["Alex Doe", "Taylor"]);
  });

  it("flags overdue and due soon correctly", () => {
    const overdueDate = new Date(Date.now() - 86400000).toISOString();
    const soonDate = new Date(Date.now() + 2 * 86400000).toISOString();
    expect(isTaskOverdue({ status: "todo", _source: "personal", dueAt: overdueDate })).toBe(true);
    expect(isTaskDueSoon({ status: "todo", _source: "personal", dueAt: soonDate })).toBe(true);
  });

  it("sorts overdue and due-soon tasks ahead of others", () => {
    const now = Date.now();
    const tasks = [
      { _source: "operational", status: "todo", dueAt: new Date(now + 10 * 86400000).toISOString(), priority: "critical" },
      { _source: "operational", status: "todo", dueAt: new Date(now - 1 * 86400000).toISOString(), priority: "low" },
      { _source: "operational", status: "todo", dueAt: new Date(now + 1 * 86400000).toISOString(), priority: "normal" },
    ];
    const sorted = [...tasks].sort(compareTasksSmart);
    expect(sorted[0].dueAt).toBe(tasks[1].dueAt);
    expect(sorted[1].dueAt).toBe(tasks[2].dueAt);
  });

  it("enforces permission-aware reassignment visibility", () => {
    expect(canReassignTask({ status: "todo", _source: "plan", _trackingRole: "assignee" }, "ENGINEER")).toBe(false);
    expect(canReassignTask({ status: "todo", _source: "operational", _trackingRole: "assignee" }, "ENGINEER")).toBe(true);
    expect(canReassignTask({ status: "todo", _source: "engineering_task" }, "ENGINEERING_MANAGER")).toBe(true);
  });
});
