import { describe, expect, it, vi } from "vitest";
import {
  buildLegacyProjectNameRedirect,
  buildProjectDetailPath,
  getVisibleFinanceSubTabs,
  getVisibleProjectDepartments,
  normalizeProjectDetailDeepLink,
  summarizeImportLineage,
} from "../../client/src/lib/project-detail-navigation";
import { invalidateProjectV2Queries } from "../../client/src/hooks/use-project-v2";
import { projectDetailResponseSchema } from "../../shared/api-types/project-v2";

describe("Project Detail command surface routing", () => {
  it("defaults canonical project detail deep links to the command centre", () => {
    expect(normalizeProjectDetailDeepLink("?dept=overview")).toEqual({
      dept: "overview",
      sub: "command",
    });
  });

  it("redirects legacy name routes to the canonical ID route without dropping query params", () => {
    expect(
      buildLegacyProjectNameRedirect(42, "?dept=finance&sub=cashflow&qualityFilter=fail"),
    ).toBe("/project/id/42?dept=finance&sub=cashflow&qualityFilter=fail");
  });

  it("builds canonical ID deep links and normalizes legacy subTab parameters", () => {
    const next = buildProjectDetailPath({
      projectId: 42,
      currentSearch: "?dept=pm&subTab=board&chip=handover-blocked",
      dept: "quality",
      sub: "checklist",
    });

    expect(next).toBe("/project/id/42?chip=handover-blocked&dept=quality&sub=checklist");
    expect(normalizeProjectDetailDeepLink("?dept=quality&subTab=approvals")).toEqual({
      dept: "history",
      sub: "approvals",
    });
    expect(normalizeProjectDetailDeepLink("?tab=sharepoint")).toEqual({
      dept: "documents",
      sub: "controlled-docs",
    });
    expect(normalizeProjectDetailDeepLink("?tab=change-control")).toEqual({
      dept: "history",
      sub: "changes",
    });
    expect(normalizeProjectDetailDeepLink("?tab=procurement")).toEqual({
      dept: "procurement",
      sub: "procurement",
    });
  });
});

describe("Project Detail permission-gated navigation", () => {
  it("orders visible departments by operating workflow and hides restricted workstreams", () => {
    const visible = getVisibleProjectDepartments({
      overview: true,
      pm: true,
      engineering: false,
      quality: false,
      finance: false,
      procurement: false,
      documents: true,
      history: true,
      excel: false,
    }).map((d) => d.key);

    expect(visible).toEqual(["overview", "pm", "documents", "history"]);
  });

  it("keeps finance subtabs commercial-only while procurement has its own department", () => {
    const visible = getVisibleFinanceSubTabs({
      revenue: true,
      expenditure: true,
      cosTracker: false,
      revenueTracker: true,
      gpTracker: true,
      cashflow: false,
      quickBooks: true,
    }).map((t) => t.key);

    expect(visible).toContain("revenue");
    expect(visible).toContain("cost-lines");
    expect(visible).not.toContain("cos-tracker");
    expect(visible).not.toContain("procurement");
    expect(visible).not.toContain("subcontractors");
    expect(visible).not.toContain("cashflow");
  });
});

describe("Project Detail source lineage contract", () => {
  it("accepts import lineage on the V2 project detail response", () => {
    const parsed = projectDetailResponseSchema.parse({
      project: {
        id: 42,
        projectName: "Solar A",
        sizeKwp: "1200",
        pd: "PD",
        pm: "PM",
        contractValue: "1000000",
        clientId: 7,
        pmUserId: 8,
        pdUserId: 9,
      },
      executionState: null,
      settings: { excelTrackerLink: null },
      financeSummary: {
        totalRevenue: 100,
        receivedRevenue: 25,
        outstandingRevenue: 75,
        totalCost: 50,
        paidCost: 10,
        outstandingCost: 40,
        marginPct: 50,
        contractValue: 100,
      },
      planSummary: {
        taskCount: 0,
        tasksCompleted: 0,
        tasksInProgress: 0,
        tasksOverdue: 0,
        tasksActive: 0,
        completionPct: 0,
      },
      qualitySummary: { checklistProgress: null, openWarnings: 0 },
      team: [],
      permissions: {
        canView: true,
        canEdit: false,
        canApprove: false,
        canDelete: false,
        canManageTeam: false,
        canOverrideFinance: false,
      },
      importLineage: {
        latestImport: {
          importRunId: 99,
          sourceFileName: "EE Tracker.xlsx",
          importType: "smart_import_v2",
          status: "committed",
          uploadedAt: "2026-05-20T08:00:00.000Z",
          committedAt: "2026-05-20T08:04:00.000Z",
          recordsSucceeded: 123,
          recordsFailed: 0,
        },
        freshness: {
          state: "live",
          daysSinceImport: 1,
          warning: null,
        },
      },
    });

    expect(parsed.importLineage.latestImport?.sourceFileName).toBe("EE Tracker.xlsx");
    expect(summarizeImportLineage(parsed.importLineage)).toEqual({
      label: "Live",
      detail: "EE Tracker.xlsx | Run #99 | 2026-05-20",
      tone: "success",
    });
  });

  it("surfaces missing import metadata as a warning instead of a silent blank", () => {
    expect(
      summarizeImportLineage({
        latestImport: null,
        freshness: { state: "missing", daysSinceImport: null, warning: "No committed tracker import found" },
      }),
    ).toEqual({
      label: "Missing import",
      detail: "No committed tracker import found",
      tone: "warning",
    });
  });
});

describe("Project Detail update invalidation", () => {
  it("invalidates legacy finance and route data after project updates when a project name is supplied", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateProjectV2Queries(queryClient, 42, "Solar A");

    const keys = invalidateQueries.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["v2-project-detail", 42]);
    expect(keys).toContainEqual(["revenue-tab", "Solar A"]);
    expect(keys).toContainEqual(["expenditure-breakdown", "Solar A", 42]);
    expect(keys).toContainEqual(["cashflow", "Solar A"]);
    expect(keys).toContainEqual(["/api/projects-summary"]);
  });
});
