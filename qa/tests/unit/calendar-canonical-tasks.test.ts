import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * Phase 1 canonicalization tests — verify that calendar routes, recurrence logic,
 * and assignment-service no longer read or write the legacy mytool_tasks table
 * for active runtime paths.
 *
 * These are static-analysis tests that scan source files for forbidden patterns.
 */

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("calendar personal-task canonicalization", () => {
  // Handlers were extracted from server/routes.ts to server/routes/mytool-routes.ts
  const routesSrc = readFile("server/routes/mytool-routes.ts");

  describe("GET /api/calendar/my-tasks", () => {
    // Extract the handler block for the calendar my-tasks route
    const handlerStart = routesSrc.indexOf('app.get("/api/calendar/my-tasks"');
    const handlerBlock = routesSrc.slice(handlerStart, handlerStart + 2500);

    it("does NOT read from mytoolTasks table", () => {
      // The personal tasks query should use workItems, not mytoolTasks
      expect(handlerBlock).not.toMatch(/\.from\(mytoolTasks\)/);
      expect(handlerBlock).not.toMatch(/from\s+mytool_tasks\b/i);
    });

    it("reads personal tasks from work_items with PERSONAL workstream", () => {
      expect(handlerBlock).toContain('workItems.workstream');
      expect(handlerBlock).toContain('"PERSONAL"');
    });

    it("filters out deleted personal tasks", () => {
      // First query (personal tasks) should check deletedAt
      const firstQuery = handlerBlock.slice(0, handlerBlock.indexOf("db.select().from(workItems).where"));
      // The personal tasks select should include isNull(workItems.deletedAt) or equivalent
      expect(handlerBlock).toContain("workItems.deletedAt");
    });

    it("excludes PERSONAL and ENG from operational query to prevent duplicates", () => {
      expect(handlerBlock).toMatch(/PERSONAL.*ENG|workstream.*NOT IN/i);
    });
  });

  describe("PATCH /api/calendar/schedule-task (mytool branch)", () => {
    const scheduleStart = routesSrc.indexOf('app.patch("/api/calendar/schedule-task"');
    const scheduleBlock = routesSrc.slice(scheduleStart, scheduleStart + 4000);
    // Extract just the mytool branch (from "mytool" check to the next "else if")
    const mytoolBranchStart = scheduleBlock.indexOf('if (taskType === "mytool")');
    const mytoolBranchEnd = scheduleBlock.indexOf('} else if (taskType === "operational")');
    const mytoolBranch = scheduleBlock.slice(mytoolBranchStart, mytoolBranchEnd);

    it("does NOT read from mytoolTasks table", () => {
      expect(mytoolBranch).not.toMatch(/\.from\(mytoolTasks\)/);
      expect(mytoolBranch).not.toMatch(/\.update\(mytoolTasks\)/);
    });

    it("reads and writes work_items for personal task scheduling", () => {
      expect(mytoolBranch).toContain(".from(workItems)");
      expect(mytoolBranch).toContain(".update(workItems)");
    });

    it("scopes to PERSONAL workstream for ownership check", () => {
      expect(mytoolBranch).toContain('"PERSONAL"');
    });

    it("checks deletedAt for soft-delete safety", () => {
      expect(mytoolBranch).toContain("deletedAt");
    });
  });

  describe("recurrence duplicate check", () => {
    // Find the recurrence duplicate check in the mytool task update handler
    const recurrenceStart = routesSrc.indexOf("const existingInstance = await db.select().from(");
    const recurrenceBlock = routesSrc.slice(recurrenceStart, recurrenceStart + 500);

    it("checks work_items for existing recurrence instances, not mytool_tasks", () => {
      expect(recurrenceBlock).toContain(".from(workItems)");
      expect(recurrenceBlock).not.toMatch(/\.from\(mytoolTasks\)/);
    });

    it("scopes recurrence check to PERSONAL workstream", () => {
      expect(recurrenceBlock).toContain('"PERSONAL"');
    });

    it("uses scheduledDate for date matching (work_items column name)", () => {
      expect(recurrenceBlock).toContain("workItems.scheduledDate");
    });
  });

  describe("GET /api/mytool/tasks — feature flag removal", () => {
    const mytoolGetStart = routesSrc.indexOf('app.get("/api/mytool/tasks"');
    const mytoolGetBlock = routesSrc.slice(mytoolGetStart, mytoolGetStart + 600);

    it("does NOT gate on isWorkItemsEnabled feature flag", () => {
      expect(mytoolGetBlock).not.toContain("isWorkItemsEnabled");
    });

    it("does NOT call getWorkItemsAsMytoolTasks adapter directly", () => {
      expect(mytoolGetBlock).not.toContain("getWorkItemsAsMytoolTasks");
    });

    it("uses storage.getMytoolTasks which reads from work_items", () => {
      expect(mytoolGetBlock).toContain("storage.getMytoolTasks");
    });
  });
});

describe("assignment-service personal-task canonicalization", () => {
  const assignmentSrc = readFile("server/services/assignment-service.ts");

  it("does NOT import mytoolTasks from schema", () => {
    // The import block should not contain mytoolTasks
    const importBlock = assignmentSrc.slice(0, assignmentSrc.indexOf("from \"../db\""));
    expect(importBlock).not.toContain("mytoolTasks");
  });

  it("does NOT read from mytoolTasks anywhere in the file", () => {
    expect(assignmentSrc).not.toMatch(/\.from\(mytoolTasks\)/);
  });

  it("does NOT write to mytoolTasks anywhere in the file", () => {
    expect(assignmentSrc).not.toMatch(/\.update\(mytoolTasks\)/);
  });

  it("uses workItems for personal_task assignment lookup", () => {
    // The personal_task case in getLegacyAssignments should use workItems
    const personalCaseStart = assignmentSrc.indexOf('case "personal_task"');
    const personalBlock = assignmentSrc.slice(personalCaseStart, personalCaseStart + 500);
    expect(personalBlock).toContain(".from(workItems)");
  });

  it("uses workItems for personal_task ownership update", () => {
    // Find the sync function's personal_task case
    const syncCases = assignmentSrc.slice(assignmentSrc.lastIndexOf('case "personal_task"'));
    const syncBlock = syncCases.slice(0, syncCases.indexOf("return;") + 10);
    expect(syncBlock).toContain(".update(workItems)");
  });
});

describe("personal task CRUD is canonical (repository layer)", () => {
  const repoSrc = readFile("server/repositories/work-management-repository.ts");

  it("getMytoolTasks reads from work_items with PERSONAL workstream", () => {
    const fnStart = repoSrc.indexOf("async getMytoolTasks(");
    const fnBlock = repoSrc.slice(fnStart, fnStart + 300);
    expect(fnBlock).toContain(".from(workItems)");
    expect(fnBlock).toContain('"PERSONAL"');
  });

  it("createMytoolTask inserts into work_items", () => {
    const fnStart = repoSrc.indexOf("async createMytoolTask(");
    const fnBlock = repoSrc.slice(fnStart, fnStart + 500);
    expect(fnBlock).toContain(".insert(workItems)");
    expect(fnBlock).toContain('"PERSONAL"');
  });

  it("updateMytoolTask updates work_items", () => {
    const fnStart = repoSrc.indexOf("async updateMytoolTask(");
    const fnEnd = repoSrc.indexOf("async deleteMytoolTask(");
    const fnBlock = repoSrc.slice(fnStart, fnEnd);
    expect(fnBlock).toMatch(/\.update\(workItems\)/);
    // Must NOT reference mytoolTasks
    expect(fnBlock).not.toMatch(/mytoolTasks/);
  });

  it("deleteMytoolTask soft-deletes via work_items", () => {
    const fnStart = repoSrc.indexOf("async deleteMytoolTask(");
    const fnBlock = repoSrc.slice(fnStart, fnStart + 200);
    expect(fnBlock).toContain(".update(workItems)");
    expect(fnBlock).toContain("deletedAt");
  });
});
