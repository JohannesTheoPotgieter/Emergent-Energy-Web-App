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

  it("ProjectFinanceCanonical reads ONLY the canonical per-project read path", () => {
    const src = read("client/src/components/finance/ProjectFinanceCanonical.tsx");
    // The § 3.3.2 single read path + the canonical reconciliation status.
    expect(src).toContain("/api/finance/lines/${projectId}");
    expect(src).toContain("/api/finance/reconciliation/${projectId}");
    // It must NOT reach for any of the retired parallel per-project endpoints.
    expect(src).not.toMatch(/cos-tracker\/project|revenue-tracker\/project|gp-tracker\/project|revenue-tab/);
  });

  it("project-detail renders the canonical finance view, not the retired parallel tabs", () => {
    const src = read("client/src/pages/project-detail.tsx");
    expect(src).toContain("ProjectFinanceCanonical");
    // None of the parallel-computation tabs may be imported any more.
    expect(src).not.toMatch(/from ["']@\/components\/tabs\/(RevenueTrackingTab|RevenueTrackerTab|MonthlyRealisationTab|GpTrackerTab)["']/);
  });

  it("project-detail commercial expenditure query includes projectId query param", () => {
    const src = read("client/src/pages/project-detail.tsx");
    expect(src).toContain('params.set("projectId", String(projectInfoId))');
    expect(src).toContain('/api/expenditure-breakdown/${encodeURIComponent(projectName)}');
  });
});
