import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 5B — Legacy personal-task schema cleanup verification.
 *
 * Verify that:
 * 1. mytoolTaskDependencies schema definition is removed
 * 2. mytoolTasks is marked deprecated but retained (FK dependencies)
 * 3. Dead type imports are cleaned up
 * 4. No runtime code references removed schema objects
 * 5. Independent mytool entities are untouched
 * 6. Archive migration exists
 */

describe("mytoolTaskDependencies schema removed", () => {
  const schemaSrc = readFile("shared/schema/mytool.ts");

  it("does not export mytoolTaskDependencies table definition", () => {
    expect(schemaSrc).not.toMatch(/export const mytoolTaskDependencies\s*=/);
  });

  it("does not export InsertMytoolTaskDependency type", () => {
    expect(schemaSrc).not.toMatch(/export type InsertMytoolTaskDependency/);
  });

  it("does not export MytoolTaskDependency type", () => {
    expect(schemaSrc).not.toMatch(/export type MytoolTaskDependency/);
  });

  it("does not export insertMytoolTaskDependencySchema", () => {
    expect(schemaSrc).not.toMatch(/export const insertMytoolTaskDependencySchema/);
  });

  it("contains a comment indicating the table was dropped in Phase 5B", () => {
    expect(schemaSrc).toContain("DROPPED (Phase 5B)");
  });
});

describe("mytoolTasks schema retained but deprecated", () => {
  const schemaSrc = readFile("shared/schema/mytool.ts");

  it("still exports mytoolTasks (needed by FK references from other tables)", () => {
    expect(schemaSrc).toMatch(/export const mytoolTasks\s*=\s*pgTable/);
  });

  it("has @deprecated JSDoc marker", () => {
    expect(schemaSrc).toContain("@deprecated");
    expect(schemaSrc).toContain("personal tasks now live in work_items");
  });

  it("still exports MytoolTask and InsertMytoolTask types", () => {
    expect(schemaSrc).toMatch(/export type MytoolTask/);
    expect(schemaSrc).toMatch(/export type InsertMytoolTask/);
  });
});

describe("independent mytool entities are untouched", () => {
  const schemaSrc = readFile("shared/schema/mytool.ts");

  const RETAINED_TABLES = [
    "mytoolRecurrenceTemplates",
    "mytoolRecurrenceInstances",
    "mytoolTimeblocks",
    "mytoolDailyReviews",
    "mytoolCompanyPriorities",
    "mytoolUserPreferences",
    "mytoolEmailLinks",
    "mytoolDodTemplates",
    "mytoolSettings",
    "triageRules",
    "priorityLinks",
    "priorityProjects",
  ];

  for (const table of RETAINED_TABLES) {
    it(`${table} is still exported`, () => {
      expect(schemaSrc).toContain(`export const ${table}`);
    });
  }
});

describe("dead type imports removed from server files", () => {
  it("storage.ts does not import MytoolTask or InsertMytoolTask", () => {
    const src = readFile("server/storage.ts");
    expect(src).not.toMatch(/type MytoolTask[^D]/);
    expect(src).not.toMatch(/type InsertMytoolTask/);
  });

  it("work-management-repository.ts does not import MytoolTask or InsertMytoolTask", () => {
    const src = readFile("server/repositories/work-management-repository.ts");
    expect(src).not.toMatch(/type InsertMytoolTask[^D]/);
    expect(src).not.toMatch(/type MytoolTask[^D]/);
  });
});

describe("lifecycle-routes no-op SQL removed", () => {
  const src = readFile("server/lifecycle-routes.ts");

  it("does not contain UPDATE mytool_tasks SQL", () => {
    expect(src).not.toMatch(/UPDATE mytool_tasks/);
  });

  it("contains comment explaining removal", () => {
    expect(src).toContain("mytool_tasks cleanup removed");
  });
});

describe("archive migration exists for mytool_task_dependencies", () => {
  it("migration file exists", () => {
    const migrationPath = path.join(ROOT, "migrations/20260401_drop_mytool_task_dependencies.sql");
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("migration creates archive table before dropping", () => {
    const src = readFile("migrations/20260401_drop_mytool_task_dependencies.sql");
    expect(src).toContain("_archive_mytool_task_dependencies");
    expect(src).toContain("DROP TABLE IF EXISTS mytool_task_dependencies");
  });
});

describe("no server runtime file references removed schema objects", () => {
  const SERVER_DIRS = ["server"];

  function walkTsFiles(dir: string): string[] {
    const result: string[] = [];
    const entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory() && !["node_modules", "dist", ".git"].includes(entry.name)) {
        result.push(...walkTsFiles(rel));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        result.push(rel);
      }
    }
    return result;
  }

  const allServerTs = SERVER_DIRS.flatMap(walkTsFiles);

  it("no server .ts file imports mytoolTaskDependencies", () => {
    const violations: string[] = [];
    for (const file of allServerTs) {
      const src = readFile(file);
      if (/\bmytoolTaskDependencies\b/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations, `Files still referencing mytoolTaskDependencies: ${violations.join(", ")}`).toEqual([]);
  });

  it("no server .ts file imports InsertMytoolTaskDependency or MytoolTaskDependency", () => {
    const violations: string[] = [];
    for (const file of allServerTs) {
      const src = readFile(file);
      if (/\bInsertMytoolTaskDependency\b/.test(src) || /\bMytoolTaskDependency\b/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations, `Files still referencing dependency types: ${violations.join(", ")}`).toEqual([]);
  });
});
