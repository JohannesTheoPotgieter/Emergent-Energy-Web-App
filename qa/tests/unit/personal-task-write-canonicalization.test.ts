import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 2.5 — verify that ALL active runtime write paths for personal tasks
 * now insert into work_items (workstream=PERSONAL), not mytool_tasks.
 *
 * Also verify KPI traceability counts from canonical source.
 */

describe("project-linking-service personal-task write canonicalization", () => {
  const src = readFile("server/project-linking-service.ts");

  it("does NOT import mytoolTasks from schema", () => {
    const importBlock = src.slice(0, src.indexOf("from \"@shared/schema\""));
    expect(importBlock).not.toContain("mytoolTasks");
  });

  it("does NOT insert into mytoolTasks anywhere in the file", () => {
    expect(src).not.toMatch(/\.insert\(mytoolTasks\)/);
  });

  describe("createFollowUpTaskFromCommunication — personal branch", () => {
    // Extract the personal task branch (after project-linked branch)
    const fnStart = src.indexOf("export async function createFollowUpTaskFromCommunication");
    const fnEnd = src.indexOf("export async function untagFromProject");
    const fn = src.slice(fnStart, fnEnd);

    it("writes personal follow-up tasks to work_items", () => {
      // The non-project branch should insert into workItems
      expect(fn).toContain(".insert(workItems)");
    });

    it("sets workstream to PERSONAL for personal follow-ups", () => {
      expect(fn).toContain("'PERSONAL'");
    });

    it("maps status from inbox to TO DO", () => {
      expect(fn).toContain('"TO DO"');
    });

    it("maps bucket to company_ops for communication follow-ups", () => {
      expect(fn).toContain('"company_ops"');
    });

    it("still records taskType as mytool in communicationFollowUps for backward compat", () => {
      expect(fn).toContain('taskType: "mytool"');
    });
  });

  describe("convertToTask — personal branch", () => {
    const fnStart = src.indexOf("export async function convertToTask");
    const fn = src.slice(fnStart);

    it("writes personal converted tasks to work_items", () => {
      // Count insertions — should find workItems insertions, no mytoolTasks
      const workItemInserts = (fn.match(/\.insert\(workItems\)/g) || []).length;
      expect(workItemInserts).toBeGreaterThanOrEqual(2); // project branch + personal branch
    });

    it("sets workstream to PERSONAL for personal converted tasks", () => {
      expect(fn).toContain("'PERSONAL'");
    });

    it("sets bucket to personal for MS object conversions", () => {
      expect(fn).toContain('"personal"');
    });
  });
});

describe("meeting-routes personal-task write canonicalization", () => {
  const src = readFile("server/meeting-routes.ts");

  it("does NOT import mytoolTasks from schema", () => {
    const importBlock = src.slice(0, src.indexOf("from \"@shared/schema\""));
    expect(importBlock).not.toContain("mytoolTasks");
  });

  it("does NOT insert into mytoolTasks anywhere in the file", () => {
    expect(src).not.toMatch(/\.insert\(mytoolTasks\)/);
  });

  describe("action item conversion — personal branch", () => {
    // Extract the personal branch (from "} else {" after operational to end of handler)
    const personalBranchStart = src.indexOf("// Canonical: personal tasks now write to work_items (workstream=PERSONAL)");
    const personalBranchEnd = src.indexOf("task = personalTask;");
    const personalBranch = src.slice(personalBranchStart, personalBranchEnd + 100);

    it("writes personal action items to work_items", () => {
      expect(personalBranch).toContain(".insert(workItems)");
    });

    it("sets workstream to PERSONAL", () => {
      expect(personalBranch).toContain("'PERSONAL'");
    });

    it("maps priority from mytool format to work_items format", () => {
      expect(personalBranch).toMatch(/critical.*Urgent|Urgent.*critical/);
    });

    it("maps plannedForDate to scheduledDate", () => {
      expect(personalBranch).toContain("scheduledDate");
    });

    it("maps department to taskCategory", () => {
      expect(personalBranch).toContain("taskCategory");
    });
  });
});

describe("KPI traceability personal-task count canonicalization", () => {
  const src = readFile("server/repositories/kpi-traceability-repository.ts");

  it("counts personal tasks from work_items, not mytool_tasks", () => {
    // The personal tasks count query should use work_items with PERSONAL workstream
    expect(src).toContain("FROM work_items WHERE deleted_at IS NULL AND workstream = 'PERSONAL'");
  });

  it("does NOT count from mytool_tasks for personal tasks", () => {
    // Should not have a COUNT from mytool_tasks for the runtime KPI
    expect(src).not.toMatch(/COUNT\(\*\) as c FROM mytool_tasks/);
  });

  it("KPI metadata references work_items as source table for personal tasks", () => {
    // The mywork_personal_tasks KPI metadata lives in the routes file
    const routesSrc = readFile("server/kpi-traceability-routes.ts");
    const personalKpiStart = routesSrc.indexOf('"mywork_personal_tasks"');
    const personalKpiBlock = routesSrc.slice(personalKpiStart, personalKpiStart + 300);
    expect(personalKpiBlock).toContain('sourceTable: "work_items"');
  });
});

describe("no active runtime mytoolTasks inserts remain (comprehensive scan)", () => {
  const RUNTIME_FILES = [
    "server/project-linking-service.ts",
    "server/meeting-routes.ts",
    "server/routes.ts",
    "server/task-management-routes.ts",
    "server/ms-sync-routes.ts",
    "server/services/assignment-service.ts",
    "server/services/personal-task-bridge.ts",
    "server/repositories/work-management-repository.ts",
    "server/routes/operational-tasks-routes.ts",
    "server/routes/planning-tasks-routes.ts",
  ];

  for (const file of RUNTIME_FILES) {
    it(`${file} does NOT insert into mytoolTasks`, () => {
      const src = readFile(file);
      expect(src).not.toMatch(/\.insert\(mytoolTasks\)/);
    });
  }

  it("only allowed files still reference mytoolTasks for non-insert operations", () => {
    // Files that are allowed to still reference mytoolTasks:
    // - routes.ts: enrichMytoolTasks (dependency enrichment), unclassified-tasks (diagnostic)
    // - admin-recovery-routes.ts: admin tooling
    // - lifecycle-routes.ts: project deletion cleanup
    // - work-items-backfill.ts: migration
    // These are all explicitly deferred from canonicalization.
    const ALLOWED_MYTOOL_REFS = new Set([
      "server/routes.ts",
      "server/admin-recovery-routes.ts",
      "server/lifecycle-routes.ts",
      "server/work-items-backfill.ts",
      "server/departments/exco-routes.ts",
      "server/storage.ts",
      "server/repositories/work-management-repository.ts",
      "server/migration-finalize-routes.ts",
      "server/invoice-pattern-routes.ts",
      "server/lib/canonical-task-engine.ts",
      "server/services/personal-task-bridge.ts",
    ]);

    // Scan runtime files for unexpected mytoolTasks references (inserts specifically)
    for (const file of RUNTIME_FILES) {
      if (ALLOWED_MYTOOL_REFS.has(file)) continue;
      const src = readFile(file);
      const hasInsert = /\.insert\(mytoolTasks\)/.test(src);
      const hasUpdate = /\.update\(mytoolTasks\)/.test(src);
      expect(hasInsert, `${file} should not insert into mytoolTasks`).toBe(false);
      expect(hasUpdate, `${file} should not update mytoolTasks`).toBe(false);
    }
  });
});
