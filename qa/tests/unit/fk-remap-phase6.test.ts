import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 6 — FK remap verification.
 *
 * Prove that:
 * 1. mytoolTasks schema definition is fully removed
 * 2. mytoolRecurrenceInstances schema definition is removed
 * 3. mytoolTimeblocks.linkedTaskId now references workItems (not mytoolTasks)
 * 4. mytoolEmailLinks.linkedTaskId now references workItems (not mytoolTasks)
 * 5. Migration exists for FK remap and table archive/drop
 * 6. No server code references removed schema objects
 */

describe("mytoolTasks schema fully removed from Drizzle", () => {
  const src = readFile("shared/schema/mytool.ts");

  it("does not contain mytoolTasks pgTable definition", () => {
    expect(src).not.toMatch(/export const mytoolTasks\s*=\s*pgTable/);
  });

  it("does not export insertMytoolTaskSchema", () => {
    expect(src).not.toMatch(/export const insertMytoolTaskSchema/);
  });

  it("does not export MytoolTask type", () => {
    expect(src).not.toMatch(/export type MytoolTask\b/);
  });

  it("does not export InsertMytoolTask type", () => {
    expect(src).not.toMatch(/export type InsertMytoolTask\b/);
  });

  it("contains removal comment for Phase 6", () => {
    expect(src).toContain("REMOVED (Phase 6)");
  });
});

describe("mytoolRecurrenceInstances schema removed", () => {
  const src = readFile("shared/schema/mytool.ts");

  it("does not contain mytoolRecurrenceInstances pgTable definition", () => {
    expect(src).not.toMatch(/export const mytoolRecurrenceInstances\s*=\s*pgTable/);
  });

  it("contains archive comment for Phase 6", () => {
    expect(src).toContain("ARCHIVED (Phase 6)");
  });
});

describe("FK references remapped to workItems", () => {
  const src = readFile("shared/schema/mytool.ts");

  it("mytoolTimeblocks.linkedTaskId references workItems.id", () => {
    // Find the timeblocks definition
    const tbStart = src.indexOf("mytoolTimeblocks = pgTable");
    const tbBlock = src.slice(tbStart, tbStart + 600);
    expect(tbBlock).toContain("references(() => workItems.id)");
    expect(tbBlock).not.toContain("references(() => mytoolTasks.id)");
  });

  it("mytoolEmailLinks.linkedTaskId references workItems.id", () => {
    // Find the email links definition
    const elStart = src.indexOf("mytoolEmailLinks = pgTable");
    const elBlock = src.slice(elStart, elStart + 600);
    // Both linkedTaskId and linkedOperationalTaskId should reference workItems
    const workItemRefs = (elBlock.match(/references\(\(\) => workItems\.id/g) || []).length;
    expect(workItemRefs).toBeGreaterThanOrEqual(2);
    expect(elBlock).not.toContain("references(() => mytoolTasks.id)");
  });
});

describe("migration exists for FK remap", () => {
  it("migration file exists", () => {
    expect(fs.existsSync(path.join(ROOT, "migrations/20260401_remap_mytool_fks.sql"))).toBe(true);
  });

  it("archives mytool_recurrence_instances", () => {
    const sql = readFile("migrations/20260401_remap_mytool_fks.sql");
    expect(sql).toContain("_archive_mytool_recurrence_instances");
    expect(sql).toContain("DROP TABLE IF EXISTS mytool_recurrence_instances");
  });

  it("remaps mytool_timeblocks FK to work_items", () => {
    const sql = readFile("migrations/20260401_remap_mytool_fks.sql");
    expect(sql).toContain("mytool_timeblocks_linked_task_id_work_items_fk");
    expect(sql).toContain("REFERENCES work_items(id)");
  });

  it("remaps mytool_email_links FK to work_items", () => {
    const sql = readFile("migrations/20260401_remap_mytool_fks.sql");
    expect(sql).toContain("mytool_email_links_linked_task_id_work_items_fk");
  });

  it("archives and drops mytool_tasks", () => {
    const sql = readFile("migrations/20260401_remap_mytool_fks.sql");
    expect(sql).toContain("_archive_mytool_tasks");
    expect(sql).toContain("DROP TABLE IF EXISTS mytool_tasks CASCADE");
  });
});

describe("independent mytool entities remain intact", () => {
  const src = readFile("shared/schema/mytool.ts");

  const MUST_REMAIN = [
    "mytoolRecurrenceTemplates",
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

  for (const table of MUST_REMAIN) {
    it(`${table} is still exported`, () => {
      expect(src).toContain(`export const ${table}`);
    });
  }
});

describe("no server runtime code references removed objects", () => {
  function walkTsFiles(dir: string): string[] {
    const result: string[] = [];
    const entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory() && !["node_modules", "dist", ".git"].includes(entry.name)) {
        result.push(...walkTsFiles(rel));
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !rel.includes("qa/tests")) {
        result.push(rel);
      }
    }
    return result;
  }

  const serverFiles = walkTsFiles("server");

  it("no server file references mytoolTasks as a runtime identifier", () => {
    const violations: string[] = [];
    for (const file of serverFiles) {
      const src = readFile(file);
      // Match mytoolTasks as an identifier (not inside a string or comment about the migration)
      if (/\bmytoolTasks\b/.test(src) && !file.includes("backfill") && !file.includes("migration")) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no server file references mytoolRecurrenceInstances", () => {
    const violations: string[] = [];
    for (const file of serverFiles) {
      const src = readFile(file);
      if (/\bmytoolRecurrenceInstances\b/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
