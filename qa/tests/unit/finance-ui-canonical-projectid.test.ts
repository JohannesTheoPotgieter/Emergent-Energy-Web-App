import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("high-risk finance screens pass projectId into canonical project endpoints", () => {
  it("ExpenditureEditableTab includes projectId query param for expenditure-breakdown", () => {
    const src = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    expect(src).toContain('params.set("projectId", String(projectId))');
    expect(src).toContain('/api/expenditure-breakdown/${encodeURIComponent(projectName)}');
  });

  it("MonthlyRealisationTab includes projectId query param", () => {
    const src = read("client/src/components/tabs/MonthlyRealisationTab.tsx");
    expect(src).toContain('params.set("projectId", String(projectId))');
    expect(src).toContain('/api/cos-tracker/project/${encodeURIComponent(projectName)}');
  });

  it("RevenueTrackerTab includes projectId query param", () => {
    const src = read("client/src/components/tabs/RevenueTrackerTab.tsx");
    expect(src).toContain('params.set("projectId", String(projectId))');
    expect(src).toContain('/api/revenue-tracker/project/${encodeURIComponent(projectName)}');
  });

  it("GpTrackerTab includes projectId query param", () => {
    const src = read("client/src/components/tabs/GpTrackerTab.tsx");
    expect(src).toContain('params.set("projectId", String(projectId))');
    expect(src).toContain('/api/gp-tracker/project/${encodeURIComponent(projectName)}');
  });

  it("project-detail commercial expenditure query includes projectId query param", () => {
    const src = read("client/src/pages/project-detail.tsx");
    expect(src).toContain('params.set("projectId", String(projectInfoId))');
    expect(src).toContain('/api/expenditure-breakdown/${encodeURIComponent(projectName)}');
  });
});
