// @vitest-environment jsdom
// Task #124 — focused reproducer for the React #310 ("rendered more hooks
// than during the previous render") report on the Commercial tab.
//
// The Commercial tab's only consumer of `/api/v2/projects/:id/finance` is
// `useProjectFinance` from `client/src/hooks/use-project-v2.ts`. This test
// mounts that hook the same way `project-detail.tsx` did — with `enabled`
// toggled by tab activation — and forces the underlying fetch to a 500
// (the exact server-side failure mode that Task #124 fixes). We then drive
// the component through every state transition that happens at runtime
// when a user opens a project from /quality and lands on the Commercial
// tab while the API is failing:
//
//     idle  →  enabled=true / fetching  →  error  →  re-render under error
//
// At each transition we assert (a) the component renders without throwing
// and (b) `console.error` never receives the React minified-error message
// for #310 ("Rendered more hooks than during the previous render").
//
// If a future change re-introduces a conditional hook on the finance-error
// path, this test fails loudly — instead of bubbling up as an opaque
// minified production error in the browser.
import * as React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/queryClient";
import { useProjectFinance } from "@/hooks/use-project-v2";

const mockedApiRequest = vi.mocked(apiRequest);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function FinanceProbe({
  projectId,
  enabled,
}: {
  projectId: number | undefined;
  enabled: boolean;
}) {
  const { data, isLoading, isError, error } = useProjectFinance(projectId, enabled);
  return (
    <div data-testid="finance-probe">
      <span data-testid="finance-state">
        {isLoading ? "loading" : isError ? "error" : data ? "success" : "idle"}
      </span>
      <span data-testid="finance-error-message">
        {(error as Error | null)?.message ?? ""}
      </span>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("useProjectFinance under /finance 500 — no hook-count mismatch (Task #124)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const errorMessages: string[] = [];

  beforeEach(() => {
    errorMessages.length = 0;
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errorMessages.push(args.map(String).join(" "));
      });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("transitions idle → fetching → error → re-render without firing React #310", async () => {
    mockedApiRequest.mockImplementation(async () => {
      throw new Error("Server Error: invalid input value for enum cost_line_status: \"APPROVED\"");
    });

    const { rerender } = renderWithClient(
      <FinanceProbe projectId={281} enabled={false} />,
    );

    // Idle: hook is disabled, enabled flag false.
    expect(screen.getByTestId("finance-state").textContent).toBe("idle");

    // Activate the tab — same transition project-detail.tsx triggered.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <FinanceProbe projectId={281} enabled={true} />
      </QueryClientProvider>,
    );

    // Wait for TanStack Query to surface the error state from the 500.
    await waitFor(() => {
      expect(screen.getByTestId("finance-state").textContent).toBe("error");
    });
    expect(screen.getByTestId("finance-error-message").textContent).toContain("Server Error");

    // Force one more render under the error state — this is where a
    // conditional hook would diverge if one existed.
    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
          <FinanceProbe projectId={281} enabled={true} />
        </QueryClientProvider>,
      );
    });

    // The whole point of the test:
    const hookMismatch = errorMessages.filter((m) =>
      /Rendered more hooks than during the previous render|Minified React error #310/i.test(m),
    );
    expect(hookMismatch).toEqual([]);
  });

  it("transitioning enabled flag back to false after error does not fire React #310", async () => {
    mockedApiRequest.mockImplementation(async () => {
      throw new Error("Server Error: 500");
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <FinanceProbe projectId={281} enabled={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("finance-state").textContent).toBe("error");
    });

    // User navigates away from the Commercial tab — same enabled-flag
    // transition project-detail.tsx triggers. A conditional hook would
    // surface as a #310 here.
    await act(async () => {
      rerender(
        <QueryClientProvider client={client}>
          <FinanceProbe projectId={281} enabled={false} />
        </QueryClientProvider>,
      );
    });

    const hookMismatch = errorMessages.filter((m) =>
      /Rendered more hooks than during the previous render|Minified React error #310/i.test(m),
    );
    expect(hookMismatch).toEqual([]);
  });
});
