// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/queryClient";
import { useProjectPlan, useProjectQuality, useProjectEngineering } from "@/hooks/use-project-v2";

function Probe({ enabled }: { enabled: boolean }) {
  useProjectPlan(99, enabled);
  useProjectQuality(99, enabled);
  useProjectEngineering(99, enabled);
  return <div>ok</div>;
}

describe("project-v2 lazy-load hooks", () => {
  it("do not call API while disabled; call only when active", async () => {
    const mocked = vi.mocked(apiRequest);
    mocked.mockResolvedValue({ json: async () => ({}) } as any);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Probe enabled={false} />
      </QueryClientProvider>,
    );

    expect(mocked).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={qc}>
        <Probe enabled={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocked).toHaveBeenCalled());
    const urls = mocked.mock.calls.map((c) => c[1]);
    expect(urls).toContain("/api/v2/projects/99/plan");
    expect(urls).toContain("/api/v2/projects/99/quality");
    expect(urls).toContain("/api/v2/projects/99/engineering");
  });
});

