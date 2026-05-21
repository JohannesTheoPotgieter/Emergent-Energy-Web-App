import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/api/v2/repositories/project-v2-repository", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createWorkItem: vi.fn(),
    patchWorkItem: vi.fn(),
    createProcurementItem: vi.fn(),
    patchProcurementItem: vi.fn(),
    getProjectById: vi.fn(),
    getProjectExecutionState: vi.fn(),
    getProjectSettings: vi.fn(),
    getProjectTeam: vi.fn(),
    getProjectMetricsFromMaterialized: vi.fn(),
    getProjectPlanSummary: vi.fn(),
    getProjectQualitySummary: vi.fn(),
    getLatestProjectImportRun: vi.fn(),
  };
});

vi.mock("../../server/services/dashboard-metrics", () => ({
  refreshAllMetrics: vi.fn(),
  refreshProjectMetricsAsync: vi.fn(),
}));

describe("project-v2 service regressions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("work item create/update trigger metrics refresh", async () => {
    const service = await import("../../server/api/v2/services/project-v2-service");
    const repo = await import("../../server/api/v2/repositories/project-v2-repository");
    const metrics = await import("../../server/services/dashboard-metrics");

    vi.mocked(repo.createWorkItem).mockResolvedValue({ id: 10 } as any);
    vi.mocked(repo.patchWorkItem).mockResolvedValue({ id: 10 } as any);

    await service.createWorkItemService(77, { title: "A" }, 5);
    await service.patchWorkItemService(77, 10, { status: "DONE" });

    expect(metrics.refreshProjectMetricsAsync).toHaveBeenCalledWith(77);
    expect(metrics.refreshProjectMetricsAsync).toHaveBeenCalledTimes(2);
  });

  it("consolidated summary maps backend metric values to numbers", async () => {
    const service = await import("../../server/api/v2/services/project-v2-service");
    const repo = await import("../../server/api/v2/repositories/project-v2-repository");

    vi.mocked(repo.getProjectById).mockResolvedValue({
      id: 12, projectName: "Alpha", sizeKwp: null, pd: null, pm: null, contractValue: "1000", clientId: null, pmUserId: null, pdUserId: null,
    } as any);
    vi.mocked(repo.getProjectExecutionState).mockResolvedValue(null as any);
    vi.mocked(repo.getProjectSettings).mockResolvedValue(null as any);
    vi.mocked(repo.getProjectTeam).mockResolvedValue([] as any);
    vi.mocked(repo.getProjectMetricsFromMaterialized).mockResolvedValue({
      totalRevenue: "900", receivedRevenue: "500", outstandingRevenue: "400", totalCost: "300", paidCost: "120", outstandingCost: "180", marginPct: "66.6",
    } as any);
    vi.mocked(repo.getProjectPlanSummary).mockResolvedValue({ taskCount: 0, tasksCompleted: 0, tasksInProgress: 0, tasksOverdue: 0, tasksActive: 0, completionPct: null } as any);
    vi.mocked(repo.getProjectQualitySummary).mockResolvedValue({ checklistProgress: null, openWarnings: 0 } as any);
    vi.mocked(repo.getLatestProjectImportRun).mockResolvedValue(null as any);

    const result = await service.getConsolidatedProjectService(12);
    expect(result.financeSummary.totalRevenue).toBe(900);
    expect(result.financeSummary.receivedRevenue).toBe(500);
    expect(result.financeSummary.totalCost).toBe(300);
  });
});

