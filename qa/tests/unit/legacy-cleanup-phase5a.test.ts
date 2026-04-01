import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 5A — Legacy code cleanup verification.
 *
 * Prove that mytoolTasks and mytoolTaskDependencies are completely removed
 * from all server runtime code (no imports, no reads, no writes).
 * Schema definitions in shared/schema/ are explicitly retained.
 */

describe("mytoolTasks references fully removed from server runtime code", () => {
  const SERVER_FILES = [
    "server/routes.ts",
    "server/ms-sync-routes.ts",
    "server/storage.ts",
    "server/repositories/work-management-repository.ts",
    "server/admin-recovery-routes.ts",
    "server/services/assignment-service.ts",
    "server/project-linking-service.ts",
    "server/meeting-routes.ts",
    "server/task-management-routes.ts",
    "server/kpi-traceability-routes.ts",
    "server/departments/exco-routes.ts",
  ];

  for (const file of SERVER_FILES) {
    it(`${file} does not reference mytoolTasks`, () => {
      const src = readFile(file);
      expect(src).not.toMatch(/\bmytoolTasks\b/);
    });
  }
});

describe("mytoolTaskDependencies references fully removed from server runtime code", () => {
  const SERVER_FILES = [
    "server/routes.ts",
    "server/ms-sync-routes.ts",
    "server/storage.ts",
    "server/repositories/work-management-repository.ts",
    "server/admin-recovery-routes.ts",
    "server/services/assignment-service.ts",
    "server/project-linking-service.ts",
    "server/meeting-routes.ts",
  ];

  for (const file of SERVER_FILES) {
    it(`${file} does not reference mytoolTaskDependencies`, () => {
      const src = readFile(file);
      expect(src).not.toMatch(/\bmytoolTaskDependencies\b/);
    });
  }
});

describe("admin-recovery personal tasks use canonical work_items", () => {
  const src = readFile("server/admin-recovery-routes.ts");

  it("search route reads from work_items with PERSONAL workstream", () => {
    const personalBlock = src.slice(
      src.indexOf('params.taskType === "personal"'),
      src.indexOf('params.taskType === "engineering"')
    );
    expect(personalBlock).toContain(".from(workItems)");
    expect(personalBlock).toContain("'PERSONAL'");
  });

  it("update route writes to work_items for personal tasks", () => {
    const updateBlock = src.slice(
      src.indexOf('case "personal":'),
      src.indexOf('case "engineering_task":')
    );
    expect(updateBlock).toContain(".update(workItems)");
    expect(updateBlock).not.toContain("mytoolTasks");
  });

  it("deleted items listing reads from work_items for personal tasks", () => {
    const deletedBlock = src.slice(
      src.indexOf("deletedMytoolTasks"),
      src.indexOf("const items = [")
    );
    expect(deletedBlock).toContain(".from(workItems)");
    expect(deletedBlock).toContain("'PERSONAL'");
  });

  it("restore route updates work_items for mytool_task type", () => {
    const restoreBlock = src.slice(
      src.indexOf('item.type === "mytool_task"'),
      src.indexOf('item.type === "mytool_task"') + 200
    );
    expect(restoreBlock).toContain(".update(workItems)");
    expect(restoreBlock).not.toContain("mytoolTasks");
  });
});

describe("unclassified-tasks routes use canonical work_items", () => {
  it("routes.ts unclassified-tasks reads from work_items", () => {
    const src = readFile("server/routes.ts");
    const routeStart = src.indexOf('/api/mytool/unclassified-tasks');
    const routeBlock = src.slice(routeStart, routeStart + 500);
    expect(routeBlock).toContain(".from(workItems)");
    expect(routeBlock).toContain('"PERSONAL"');
    expect(routeBlock).not.toContain("mytoolTasks");
  });

  it("exco-routes.ts unclassified-tasks reads from work_items", () => {
    const src = readFile("server/departments/exco-routes.ts");
    const routeStart = src.indexOf('/api/mytool/unclassified-tasks');
    const routeBlock = src.slice(routeStart, routeStart + 500);
    expect(routeBlock).toContain(".from(workItems)");
    expect(routeBlock).toContain('"PERSONAL"');
    expect(routeBlock).not.toContain("mytoolTasks");
  });
});

describe("no direct SQL references to mytool_tasks in runtime server files", () => {
  const RUNTIME_FILES = [
    "server/routes.ts",
    "server/ms-sync-routes.ts",
    "server/admin-recovery-routes.ts",
    "server/project-linking-service.ts",
    "server/meeting-routes.ts",
    "server/task-management-routes.ts",
    "server/kpi-traceability-routes.ts",
    "server/departments/exco-routes.ts",
  ];

  for (const file of RUNTIME_FILES) {
    it(`${file} does not contain raw SQL referencing mytool_tasks`, () => {
      const src = readFile(file);
      expect(src).not.toMatch(/FROM\s+mytool_tasks/i);
      expect(src).not.toMatch(/INTO\s+mytool_tasks/i);
      expect(src).not.toMatch(/UPDATE\s+mytool_tasks/i);
    });
  }

  // lifecycle-routes.ts is explicitly allowed (harmless no-op on empty table)
  it("lifecycle-routes.ts has at most one harmless mytool_tasks reference for project cleanup", () => {
    const src = readFile("server/lifecycle-routes.ts");
    const matches = src.match(/mytool_tasks/g) || [];
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});
