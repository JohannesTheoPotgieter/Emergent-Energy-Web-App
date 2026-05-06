import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 3 — Dependency canonicalization tests.
 *
 * Verify that personal task dependency enrichment and CRUD now use
 * work_item_dependencies (canonical) instead of mytool_task_dependencies (legacy).
 */

describe("enrichMytoolTasks dependency canonicalization", () => {
  const src = readFile("server/routes/mytool-routes.ts");
  const fnStart = src.indexOf("async function enrichMytoolTasks");
  const fnEnd = src.indexOf("async function refreshDependentTaskStates");
  const fn = src.slice(fnStart, fnEnd);

  it("reads from workItemDependencies, not mytoolTaskDependencies", () => {
    expect(fn).toContain(".from(workItemDependencies)");
    expect(fn).not.toContain(".from(mytoolTaskDependencies)");
  });

  it("uses predecessorId/successorId (canonical column names)", () => {
    expect(fn).toContain("workItemDependencies.predecessorId");
    expect(fn).toContain("workItemDependencies.successorId");
  });

  it("filters out soft-deleted dependencies", () => {
    expect(fn).toContain("workItemDependencies.deletedAt");
  });

  it("maps predecessor/successor IDs to legacy field names for frontend compat", () => {
    expect(fn).toContain("predecessorTaskId: d.predecessorId");
    expect(fn).toContain("successorTaskId: d.successorId");
  });

  it("still computes blockedBy and blocking arrays", () => {
    expect(fn).toContain("task.blockedBy = blockedBy");
    expect(fn).toContain("task.blocking = blocking");
    expect(fn).toContain("task.blockedByCount = blockersIncomplete.length");
    expect(fn).toContain("task.isBlockedByDependencies = blockersIncomplete.length > 0");
  });
});

describe("GET /api/mytool/tasks/:id/dependencies — canonical", () => {
  const src = readFile("server/routes/mytool-routes.ts");
  const routeStart = src.indexOf('app.get("/api/mytool/tasks/:id/dependencies"');
  const routeEnd = src.indexOf('app.post("/api/mytool/tasks/:id/dependencies"');
  const route = src.slice(routeStart, routeEnd);

  it("reads from workItemDependencies", () => {
    expect(route).toContain(".from(workItemDependencies)");
    expect(route).not.toContain(".from(mytoolTaskDependencies)");
  });

  it("filters out soft-deleted dependencies", () => {
    expect(route).toContain("workItemDependencies.deletedAt");
  });

  it("maps response to legacy shape with predecessorTaskId/successorTaskId", () => {
    expect(route).toContain("predecessorTaskId: d.predecessorId");
    expect(route).toContain("successorTaskId: d.successorId");
  });

  it("maps depType back to legacy dependencyType string", () => {
    expect(route).toContain("DEP_TYPE_FROM_CANONICAL");
  });
});

describe("POST /api/mytool/tasks/:id/dependencies — canonical", () => {
  const src = readFile("server/routes/mytool-routes.ts");
  const routeStart = src.indexOf('app.post("/api/mytool/tasks/:id/dependencies"');
  const routeEnd = src.indexOf('app.delete("/api/mytool/tasks/:id/dependencies');
  const route = src.slice(routeStart, routeEnd);

  it("inserts into workItemDependencies, not mytoolTaskDependencies", () => {
    expect(route).toContain(".insert(workItemDependencies)");
    expect(route).not.toContain(".insert(mytoolTaskDependencies)");
  });

  it("maps legacy dependencyType to canonical depType", () => {
    expect(route).toContain("DEP_TYPE_TO_CANONICAL");
  });

  it("uses predecessorId/successorId for the canonical insert", () => {
    expect(route).toContain("predecessorId: predecessorTaskId");
    expect(route).toContain("successorId: successorTaskId");
  });

  it("checks circular dependencies against workItemDependencies", () => {
    expect(route).toContain(".from(workItemDependencies)");
    expect(route).toContain("workItemDependencies.successorId");
  });
});

describe("DELETE /api/mytool/tasks/:id/dependencies/:dependencyId — canonical", () => {
  const src = readFile("server/routes/mytool-routes.ts");
  const deleteStart = src.indexOf('app.delete("/api/mytool/tasks/:id/dependencies/:dependencyId"');
  const deleteEnd = src.indexOf('app.get("/api/mytool/recurrence-templates"');
  const route = src.slice(deleteStart, deleteEnd);

  it("reads and soft-deletes from workItemDependencies", () => {
    expect(route).toContain(".from(workItemDependencies)");
    expect(route).toContain(".update(workItemDependencies)");
    expect(route).toContain("deletedAt");
  });

  it("does NOT hard-delete from mytoolTaskDependencies", () => {
    expect(route).not.toContain(".delete(mytoolTaskDependencies)");
  });
});

describe("dependency type mapping", () => {
  const src = readFile("server/routes/mytool-routes.ts");

  it("defines canonical-to-legacy mapping", () => {
    expect(src).toContain('FS: "finish_to_start"');
    expect(src).toContain('SS: "start_to_start"');
    expect(src).toContain('FF: "finish_to_finish"');
    expect(src).toContain('SF: "start_to_finish"');
  });

  it("defines legacy-to-canonical mapping", () => {
    expect(src).toContain('finish_to_start: "FS"');
    expect(src).toContain('start_to_start: "SS"');
    expect(src).toContain('finish_to_finish: "FF"');
    expect(src).toContain('start_to_finish: "SF"');
  });
});

describe("no active runtime mytoolTaskDependencies writes remain", () => {
  const src = readFile("server/routes/mytool-routes.ts");

  it("does NOT insert into mytoolTaskDependencies", () => {
    expect(src).not.toMatch(/\.insert\(mytoolTaskDependencies\)/);
  });

  it("does NOT delete from mytoolTaskDependencies", () => {
    expect(src).not.toMatch(/\.delete\(mytoolTaskDependencies\)/);
  });

  it("does NOT update mytoolTaskDependencies", () => {
    expect(src).not.toMatch(/\.update\(mytoolTaskDependencies\)/);
  });
});
