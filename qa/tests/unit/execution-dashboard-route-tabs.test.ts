import { describe, expect, it } from "vitest";
import {
  EXECUTION_DASHBOARD_TABS,
  getExecutionDashboardPathForTab,
  getExecutionDashboardTabFromPath,
} from "@/pages/execution-dashboard/route-tabs";

describe("execution dashboard route tabs", () => {
  it("maps canonical deep links to the matching dashboard tab", () => {
    expect(getExecutionDashboardTabFromPath("/execution-board")).toBe("overview");
    expect(getExecutionDashboardTabFromPath("/execution-board/program")).toBe("programme");
    expect(getExecutionDashboardTabFromPath("/execution-board/construction")).toBe("construction");
    expect(getExecutionDashboardTabFromPath("/execution-board/finance")).toBe("finance");
  });

  it("falls back to overview for unknown execution-board subroutes", () => {
    expect(getExecutionDashboardTabFromPath("/execution-board/nope")).toBe("overview");
    expect(getExecutionDashboardTabFromPath("/projects")).toBe("overview");
  });

  it("keeps tab-to-path navigation URL-addressable", () => {
    expect(EXECUTION_DASHBOARD_TABS.map((tab) => tab.value)).toEqual([
      "overview",
      "programme",
      "construction",
      "finance",
    ]);
    expect(getExecutionDashboardPathForTab("overview")).toBe("/execution-board");
    expect(getExecutionDashboardPathForTab("programme")).toBe("/execution-board/program");
    expect(getExecutionDashboardPathForTab("construction")).toBe("/execution-board/construction");
    expect(getExecutionDashboardPathForTab("finance")).toBe("/execution-board/finance");
  });
});
