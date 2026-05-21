import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Plan screen contract", () => {
  it("SQLite fallback schema includes the imported work_items columns the Plan tab reads", () => {
    const dbSource = read("server/db.ts");

    for (const column of [
      "estimate_minutes",
      "lead",
      "resource_1",
      "resource_2",
      "tracker_comments",
      "work_days",
      "cell_format",
      "import_snapshot",
      "manual_overrides",
    ]) {
      expect(dbSource).toContain(`ALTER TABLE work_items ADD COLUMN ${column}`);
    }

    expect(dbSource).toContain("CREATE TABLE IF NOT EXISTS work_item_dependencies");
  });

  it("Plan tab defaults to PM while still offering the imported workstream switcher", () => {
    const source = read("client/src/components/tabs/UnifiedPlanTab.tsx");
    const workstreamOptions = read("client/src/lib/workstream-options.ts");

    expect(source).toContain('useState<string>("PM")');
    expect(source).not.toContain('useState<string>("All")');
    expect(source).toContain("All Workstreams");
    expect(source).toContain("WORKSTREAM_OPTIONS");
    expect(workstreamOptions).toContain('value: "PM"');
    expect(workstreamOptions).toContain('label: "Project"');
    expect(source).not.toContain('height: "calc(100vh - 320px)"');
    expect(source).toContain('data-testid="plan-grid-container"');
    expect(source).toContain('aria-label="Add task"');
  });

  it("Plan API uses imported PM work_items rows when a project has WBS data, even before rollout flag enablement", () => {
    const routeSource = read("server/routes/planning-tasks-routes.ts");
    const adapterSource = read("server/work-items-adapter.ts");

    expect(adapterSource).toContain("export async function hasPlanWorkItemsForProject");
    expect(adapterSource).toMatch(/export async function hasPlanWorkItemsForProject[\s\S]*eq\(workItems\.workstream,\s*"PM"\)/);
    expect(adapterSource).toMatch(/export async function hasPlanWorkItemsForProject[\s\S]*eq\(workItems\.source,\s*"SMART_IMPORT"\)/);
    expect(routeSource).toContain("hasPlanWorkItemsForProject(projectName)");
    expect(routeSource).toContain("const useCanonical = flagAllowsCanonical || hasImportedCanonicalRows");
  });
});
