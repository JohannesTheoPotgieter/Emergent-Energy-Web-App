import { describe, expect, it, vi } from "vitest";
import { invalidateProjectV2Queries } from "../../client/src/hooks/use-project-v2";

describe("invalidateProjectV2Queries", () => {
  it("invalidates all project-v2 and summary query keys", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateProjectV2Queries(queryClient, 42);

    const keys = invalidateQueries.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual([
      ["v2-project-detail", 42],
      ["v2-project-finance", 42],
      ["v2-project-plan", 42],
      ["v2-project-quality", 42],
      ["v2-project-engineering", 42],
      ["project-header-kpis", 42],
      ["health-summary"],
    ]);
  });

  it("does nothing for nullish ids", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateProjectV2Queries(queryClient, null);
    invalidateProjectV2Queries(queryClient, undefined);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

