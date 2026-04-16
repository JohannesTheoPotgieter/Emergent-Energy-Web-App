import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Engineering data trust tests — catch the status-comparison bug class
 * that made the dashboard and warning scanner silently return wrong data.
 *
 * After migration 20260413_status_casing_normalization, work_items.status
 * stores canonical lowercase (from shared/schema/tasks.ts TASK_STATUSES).
 * listEngineeringWorkItems() returns these canonical values via
 * toCanonicalStatus(). Any server code that compares against UPPERCASE
 * magic strings will silently fail.
 *
 * These tests ensure:
 * 1. The canonical status set is lowercase_underscore.
 * 2. The server engineering-routes.ts does NOT contain UPPERCASE status
 *    comparisons against listEngineeringWorkItems output.
 * 3. The DependenciesTab no longer stores deps in HTML comments.
 * 4. The dependency endpoint table exists.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("canonical status set", () => {
  it("TASK_STATUSES are all lowercase_underscore", () => {
    const source = read("shared/schema/tasks.ts");
    const match = source.match(/export const TASK_STATUSES = \[([\s\S]*?)\] as const/);
    expect(match).toBeTruthy();
    const body = match![1];
    // Every quoted string should be lowercase with underscores only
    const strings = [...body.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    expect(strings.length).toBeGreaterThan(5);
    for (const s of strings) {
      expect(s).toBe(s.toLowerCase());
      expect(s).not.toContain(" ");
    }
  });
});

describe("engineering-routes.ts: no UPPERCASE status comparisons against adapter output", () => {
  const source = read("server/engineering-routes.ts");
  const lines = source.split("\n");

  // These are the dashboard/warning functions that use
  // listEngineeringWorkItems output, which returns canonical lowercase.
  // Scoped to lines 2000+ (dashboard/warning area) to avoid false
  // positives from the LEGACY_STATUS_TO_CANONICAL map or the
  // normalizeStatus helper which is expected to handle uppercase.

  const dashboardLines = lines.slice(2000);

  it("does not compare t.status === uppercase string in dashboard area", () => {
    const dangerousPatterns = [
      /\.status\s*===?\s*"COMPLETE"/,
      /\.status\s*===?\s*"HOLD"/,
      /\.status\s*===?\s*"IN PROGRESS"/,
      /\.status\s*===?\s*"TO DO"/,
      /\.status\s*===?\s*"NEEDS APPROVAL"/,
      /\.status\s*===?\s*"PROVIDE FEEDBACK"/,
      /\.status\s*===?\s*"QC APPROVED"/,
      /\.status\s*===?\s*"PROJECTS ASSISTANCE"/,
    ];

    for (const [idx, line] of dashboardLines.entries()) {
      if (line.trim().startsWith("//")) continue;
      for (const pattern of dangerousPatterns) {
        const matches = pattern.test(line);
        if (matches) {
          const lineNo = 2001 + idx;
          expect.soft(
            false,
            `engineering-routes.ts:${lineNo} compares against UPPERCASE status: ${line.trim()}`
          ).toBe(true);
        }
      }
    }
  });

  it("does not use an UPPERCASE openStatuses Set", () => {
    const openSetLine = dashboardLines.find(l => l.includes("openStatuses") && l.includes("new Set"));
    expect(openSetLine).toBeTruthy();
    expect(openSetLine).not.toMatch(/"[A-Z ]+"/);
  });
});

describe("DependenciesTab: no HTML-comment dependency storage", () => {
  const source = read("client/src/pages/EngineeringTasksPage.tsx");

  it("does not contain <!--deps: parsing logic", () => {
    expect(source).not.toContain("<!--deps:");
    expect(source).not.toContain("depsTag");
  });

  it("delegates to TaskDependenciesPanel", () => {
    expect(source).toContain("TaskDependenciesPanel");
  });
});

describe("TaskDependenciesPanel: proper API dependency storage", () => {
  const source = read("client/src/pages/engineering/panels/TaskDependenciesPanel.tsx");

  it("fetches from /api/dependencies/task/", () => {
    expect(source).toContain("/api/dependencies/task/");
  });

  it("creates via POST /api/dependencies", () => {
    expect(source).toContain('"/api/dependencies"');
    expect(source).toContain("POST");
  });

  it("deletes via DELETE /api/dependencies/", () => {
    expect(source).toContain("/api/dependencies/");
    expect(source).toContain("DELETE");
  });

  it("does not store deps in task description via HTML comments", () => {
    expect(source).not.toContain("<!--deps:");
    // Must not PATCH description to store deps
    expect(source).not.toMatch(/PATCH.*description|description.*PATCH/);
    expect(source).not.toContain("depsTag");
  });
});

describe("dependency table schema exists", () => {
  const source = read("shared/schema/tasks.ts");

  it("exports workItemDependencies table", () => {
    expect(source).toContain("export const workItemDependencies");
    expect(source).toContain('pgTable("work_item_dependencies"');
  });

  it("has predecessorId and successorId FKs", () => {
    expect(source).toContain("predecessorId");
    expect(source).toContain("successorId");
  });

  it("has soft-delete via deletedAt", () => {
    expect(source).toContain("deletedAt");
  });
});

describe("dependency routes: task-level endpoint exists", () => {
  const source = read("server/dependency-routes.ts");

  it("has GET /api/dependencies/task/:taskId", () => {
    expect(source).toContain('"/api/dependencies/task/:taskId"');
  });

  it("has circular dependency detection", () => {
    expect(source).toContain("detectCircular");
  });
});

describe("warning scanner: checks releasedFor for IFC-missing", () => {
  const source = read("server/engineering-routes.ts");

  it("scans projectEngDeliverables for IFC state", () => {
    expect(source).toContain("requireIfcIssuance");
    expect(source).toContain("issued_for_construction");
  });

  it("imports projectEngDeliverables", () => {
    expect(source).toContain("projectEngDeliverables");
  });
});

describe("backfill migration exists", () => {
  it("has the HTML-comment deps backfill migration", () => {
    const exists = fs.existsSync(
      path.join(REPO_ROOT, "migrations/20260416_backfill_html_comment_deps.sql")
    );
    expect(exists).toBe(true);
  });
});
