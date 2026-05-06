import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("CPM engine API/UI visibility", () => {
  const routesSrc = readFile("server/routes/working-plan-routes.ts");
  const uiSrc = readFile("client/src/components/tabs/ProjectPlanTab.tsx");

  it("exposes CPM fields from working-plan API response", () => {
    expect(routesSrc).toContain("tasks: cpmResult.tasks");
    expect(routesSrc).toContain("criticalPath: cpmResult.criticalPath");
    expect(routesSrc).toContain("projectFinish: cpmResult.projectFinish");
    expect(routesSrc).toContain("hasCircularDependency: cpmResult.hasCircularDependency");
    expect(routesSrc).toContain("warnings: cpmResult.warnings");
  });

  it("reads CPM fields in ProjectPlanTab", () => {
    expect(uiSrc).toContain("const tasks = workingPlan?.tasks || []");
    expect(uiSrc).toContain("const criticalPath = workingPlan?.criticalPath || []");
    expect(uiSrc).toContain("workingPlan?.hasCircularDependency");
  });

  it("renders critical-path indicators and circular dependency warning in UI", () => {
    expect(uiSrc).toContain("CRIT");
    expect(uiSrc).toContain("task.isCritical");
    expect(uiSrc).toContain("⚠ Circular dependency detected");
    expect(uiSrc).toContain("selectedTask.slack");
  });
});
