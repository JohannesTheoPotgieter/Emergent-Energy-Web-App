// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

// Keep the toast hook inert — we only care about the rendered error UI.
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/eng-fetch", () => ({ engFetch: vi.fn() }));

import { engFetch } from "@/lib/eng-fetch";
import { TaskDependenciesPanel } from "@/pages/engineering/panels/TaskDependenciesPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* allTasks=[] disables the secondary task-pool fetch so only the deps query runs. */}
      <TaskDependenciesPanel task={{ id: 1, title: "Task", status: "in_progress" }} allTasks={[]} />
    </QueryClientProvider>,
  );
}

describe("TaskDependenciesPanel", () => {
  it("shows a retryable error state — not an empty state — when the deps query fails", async () => {
    vi.mocked(engFetch).mockRejectedValue(new Error("boom"));
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("dependencies-error")).toBeTruthy());
    // A failed load must offer a retry and must NOT masquerade as "no dependencies".
    expect(screen.getByTestId("dependencies-retry")).toBeTruthy();
    expect(screen.queryByText(/No dependencies/i)).toBeNull();
  });

  it("shows the empty state (not an error) when there are genuinely no dependencies", async () => {
    vi.mocked(engFetch).mockResolvedValue({ dependencies: [] });
    renderPanel();

    await waitFor(() => expect(screen.getByText(/No dependencies/i)).toBeTruthy());
    expect(screen.queryByTestId("dependencies-error")).toBeNull();
  });
});
