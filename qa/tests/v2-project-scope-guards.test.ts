import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../server/api/v2/repositories/project-v2-repository", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getEngineeringStageByProject: vi.fn(),
    createEngineeringDesign: vi.fn(),
    listEngineeringDesigns: vi.fn(),
    patchEngineeringDesign: vi.fn(),
    getQualityCheckByProject: vi.fn(),
    patchQualityCheck: vi.fn(),
  };
});

describe("v2 project scope guards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("blocks patching engineering design through a different project route", async () => {
    const service = await import("../../server/api/v2/services/project-v2-service");
    const repo = await import("../../server/api/v2/repositories/project-v2-repository");

    vi.mocked(repo.listEngineeringDesigns).mockResolvedValue([{ id: 1 } as any]);
    vi.mocked(repo.patchEngineeringDesign).mockResolvedValue(null as any);

    await expect(service.patchEngineeringDesignService(200, 999, { notes: "x" }, 7)).rejects.toMatchObject({ status: 404 });
    expect(repo.patchEngineeringDesign).not.toHaveBeenCalled();
  });

  it("blocks patching quality item through a different project route", async () => {
    const service = await import("../../server/api/v2/services/project-v2-service");
    const repo = await import("../../server/api/v2/repositories/project-v2-repository");

    vi.mocked(repo.getQualityCheckByProject).mockResolvedValue(null as any);

    await expect(service.patchQualityCheckService(200, 55, { approved: true })).rejects.toMatchObject({ status: 404 });
    expect(repo.patchQualityCheck).not.toHaveBeenCalled();
  });
});
