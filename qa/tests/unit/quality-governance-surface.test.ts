import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("quality governance execution surfaces", () => {
  it("keeps the quality dashboard tied to existing routes while adding governance visibility", () => {
    const source = read("client/src/pages/qm-dashboard.tsx");

    expect(source).toContain("/api/quality/checklists");
    expect(source).toContain("/api/quality/all-items");
    expect(source).toContain("/api/quality/dashboard");
    expect(source).toContain("Overdue actions");
    expect(source).toContain("Resubmission needed");
    expect(source).toContain("Evidence gaps");
    expect(source).toContain("Blocked handover");
    expect(source).toContain("At-risk projects");
    expect(source).toContain("qualityItemId=");
  });

  it("keeps the project quality tab on existing checklist and evidence flows while adding workspace drill-down", () => {
    const source = read("client/src/components/tabs/QualityTab.tsx");

    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/checklist");
    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/workspace");
    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}/send-for-approval");
    expect(source).toContain("Priority quality queue");
    expect(source).toContain("Relevant Microsoft-linked quality items");
    expect(source).toContain("Execution readiness is currently blocked by quality context");
  });

  it("keeps server quality routes additive with project-linked governance and microsoft context", () => {
    const routes = read("server/quality-routes.ts");
    const linkingService = read("server/project-linking-service.ts");
    const myWorkLinks = read("server/lib/my-work-source-links.ts");

    expect(routes).toContain('app.get("/api/quality/project/:projectName/workspace"');
    expect(routes).toContain('app.get("/api/quality/project/:projectName/summary"');
    expect(routes).toContain('app.get("/api/quality/all-items"');
    expect(routes).toContain('app.get("/api/quality/checklists"');
    expect(routes).toContain('app.get("/api/quality/dashboard"');
    expect(linkingService).toContain("qualityContext");
    expect(linkingService).toContain("linkedQualityItemInstanceId");
    expect(myWorkLinks).toContain("Open linked quality item");
  });
});
