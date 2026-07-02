import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("CPM engine API/UI visibility", () => {
  const routesSrc = readFile("server/routes/working-plan-routes.ts");
  // The plan UI moved from the retired ProjectPlanTab to UnifiedPlanTab
  // (the live plan tab); the CPM surface now lives there.
  const uiSrc = readFile("client/src/components/tabs/UnifiedPlanTab.tsx");

  it("exposes CPM fields from working-plan API response", () => {
    expect(routesSrc).toContain("tasks: cpmResult.tasks");
    expect(routesSrc).toContain("criticalPath: cpmResult.criticalPath");
    expect(routesSrc).toContain("projectFinish: cpmResult.projectFinish");
    expect(routesSrc).toContain("hasCircularDependency: cpmResult.hasCircularDependency");
    expect(routesSrc).toContain("warnings: cpmResult.warnings");
  });

  it("reads CPM fields in UnifiedPlanTab", () => {
    expect(uiSrc).toContain("hasCircularDependency");
    expect(uiSrc).toContain("criticalTaskIds");
    expect(uiSrc).toContain("slackById");
    expect(uiSrc).toContain("projectFinish");
  });

  it("renders critical-path indicators and circular dependency warning in UI", () => {
    expect(uiSrc).toContain("isCritical");
    expect(uiSrc).toContain("showCriticalPath");
    expect(uiSrc).toContain("Circular dependency detected");
  });
});
