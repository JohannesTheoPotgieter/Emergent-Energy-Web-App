// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { MyTasksView } from "@/pages/engineering/engineering-task-views";
import type { Task } from "@/components/tasks/types";

function makeTask(over: Partial<Task>): Task {
  return {
    id: 1,
    title: "Untitled",
    status: "in_progress",
    priority: "Med",
    assignees: ["Eon Smith"],
    dueDate: null,
    projectName: null,
    ...over,
  } as unknown as Task;
}

function renderView(myName: string, tasks: Task[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MyTasksView
        tasks={tasks}
        myName={myName}
        onCardClick={() => {}}
        onStatusChange={() => {}}
        onPriorityChange={() => {}}
        filterStatuses={["in_progress"]}
      />
    </QueryClientProvider>,
  );
}

describe("MyTasksView name matching", () => {
  const tasks = [
    makeTask({ id: 1, title: "Design SLD revision", assignees: ["Eon Smith"] }),
    makeTask({ id: 2, title: "Cable schedule check", assignees: ["Thabo Mokoena"] }),
  ];

  it("an EMPTY name matches nothing (does not show every task as 'mine')", () => {
    renderView("", tasks);
    // Regression guard: `"".startsWith("")` is true for every assignee, which
    // previously made My Tasks render the whole board. It must now be empty.
    expect(screen.getByText("You have no assigned tasks")).toBeTruthy();
    expect(screen.queryByText("Design SLD revision")).toBeNull();
    expect(screen.queryByText("Cable schedule check")).toBeNull();
  });

  it("a real name matches only that person's tasks by first-name prefix", () => {
    renderView("Eon", tasks);
    // MyTasksView renders both a desktop table and a mobile card layout, so a
    // matched title appears more than once in the DOM — assert at least one.
    expect(screen.getAllByText("Design SLD revision").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cable schedule check")).toBeNull();
  });
});
