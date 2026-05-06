import { describe, expect, it } from "vitest";
import { filterEngineeringTasks } from "@/hooks/useEngineeringTaskFilters";
import type { Task } from "@/components/tasks/types";

function makeTask(overrides: Partial<Task>): Task {
  return { id: 1, title: "Task", status: "hold", priority: "Medium", assignees: [], resolvedAssignees: [], projectName: "Alpha", description: "", dueDate: null, ownerUserId: null, assigneeUserIds: [], ...overrides } as Task;
}

describe("filterEngineeringTasks deep-link behavior", () => {
  it("returns only hold tasks when status filter is hold", () => {
    const tasks = [makeTask({ id: 11, status: "hold" }), makeTask({ id: 12, status: "in_progress" })];
    const filtered = filterEngineeringTasks({ tasks, statusFilter: "hold", priorityFilter: "all", assigneeFilter: "all", projectFilter: "all", searchTerm: "", dueDateFilter: "all", workloadStateFilter: "all", linkedSourceFilter: "all" });
    expect(filtered.map((t) => t.id)).toEqual([11]);
  });
});
