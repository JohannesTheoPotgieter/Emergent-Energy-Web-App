// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectCommandHeader } from "../../../client/src/components/ProjectCommandHeader";

vi.mock("wouter", () => ({
  useLocation: () => ["/project/id/42", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/CaptureDeliverable", () => ({
  default: () => <button type="button">Capture deliverable</button>,
}));

vi.mock("@/components/POGenerator", () => ({
  POGenerator: () => <button type="button">Generate PO</button>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHeader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ProjectCommandHeader
        projectName="Solar A"
        displayName="Solar A"
        phase="P3_DETAILED_DESIGN_PROC_RELEASE"
        pd="PD"
        pm="PM"
        sizeKwp="1200 kWp"
        completion="42%"
        completionNum={42}
        contractValue={1_000_000}
        revenueRealisedPct={25}
        cosRealisedPct={10}
        marginDelta={15}
        scheduleRag="green"
        costRag="amber"
        qualityRag="red"
        ragStatus="AMBER"
        nextMilestone={{ name: "Deposit", date: "2026-05-30", allPaid: false }}
        projectInfoId={null}
        isAdmin={false}
        canSetRag={false}
        canViewFinance={false}
        canViewQuality={false}
        canViewProcurement={false}
        importLineage={{
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
          freshness: { state: "live", daysSinceImport: 1, warning: null },
        }}
        pdAssignableUsers={[]}
        pmAssignableUsers={[]}
      />
    </QueryClientProvider>,
  );
}

describe("ProjectCommandHeader rendered trust and permission state", () => {
  it("renders import lineage and masks finance KPIs without console errors", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHeader();

    expect(screen.getByTestId("project-command-header")).toBeTruthy();
    expect(screen.getByTestId("project-import-lineage").textContent).toContain("Tracker import: Live");
    expect(screen.getByTestId("kpi-revenue").textContent).toContain("Restricted");
    expect(screen.queryByText("Generate PO")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
