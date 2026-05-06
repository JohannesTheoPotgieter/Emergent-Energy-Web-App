import { describe, expect, it, vi } from "vitest";
import { createMilestoneFlow, invalidateMilestoneCreationQueries } from "@/lib/milestone-create-flow";

describe("createMilestoneFlow", () => {
  it("creates milestone for valid payload", async () => {
    const request = vi.fn(async () => ({ json: async () => ({ rowNumber: -5 }) }));

    const result = await createMilestoneFlow({
      title: "  New Milestone  ",
      projectName: "Alpha",
      request,
    });

    expect(result).toEqual({ ok: true, rowNumber: -5 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("POST", "/api/project-plan/structure", {
      operation: "createMilestone",
      projectName: "Alpha",
      data: { title: "New Milestone" },
    });
  });

  it("returns validation failure when title is missing", async () => {
    const request = vi.fn();

    const result = await createMilestoneFlow({
      title: "   ",
      projectName: "Alpha",
      request,
    });

    expect(result).toEqual({
      ok: false,
      kind: "validation",
      message: "Milestone title is required.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("returns backend failure when API errors", async () => {
    const request = vi.fn(async () => {
      throw new Error("Backend exploded");
    });

    const result = await createMilestoneFlow({
      title: "Milestone",
      projectName: "Alpha",
      request,
    });

    expect(result).toEqual({
      ok: false,
      kind: "backend",
      message: "Backend exploded",
    });
  });

  it("groups selected tasks under new milestone when rowNumber is returned", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ rowNumber: -9 }) })
      .mockResolvedValueOnce({ json: async () => ({ message: "ok" }) });

    const result = await createMilestoneFlow({
      title: "Milestone",
      projectName: "Alpha",
      request,
      selectedRowNumbers: [101, 102],
    });

    expect(result).toEqual({ ok: true, rowNumber: -9 });
    expect(request).toHaveBeenNthCalledWith(2, "POST", "/api/project-plan/structure", {
      operation: "setParent",
      projectName: "Alpha",
      data: { taskRowNumbers: [101, 102], parentRowNumber: -9 },
    });
  });
});

describe("invalidateMilestoneCreationQueries", () => {
  it("invalidates planning and summary query keys after create", () => {
    const invalidate = vi.fn();

    invalidateMilestoneCreationQueries(invalidate, "Alpha");

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenNthCalledWith(1, ["planning-tasks", "Alpha"]);
    expect(invalidate).toHaveBeenNthCalledWith(2, ["operational-tasks", "Alpha"]);
    expect(invalidate).toHaveBeenNthCalledWith(3, ["/api/projects-summary"]);
  });
});
