import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("assignment unique constraints", () => {
  const tasksSchema = read("shared/schema/tasks.ts");
  const migrationSource = read("migrations/20260331_assignment_unique_constraints.sql");
  const rollbackSource = read("migrations/20260331_assignment_unique_constraints_rollback.sql");

  // ── Schema unique constraint ──

  it("workItemAssignments defines unique constraint on (workItemId, userId, role)", () => {
    expect(tasksSchema).toContain('unique("uq_work_item_user_role").on(table.workItemId, table.userId, table.role)');
  });

  // ── Migration safety ──

  it("migration quarantines duplicates into archive table before deleting", () => {
    expect(migrationSource).toContain("work_item_assignments_dedup_archive");
    expect(migrationSource).toContain("INSERT INTO work_item_assignments_dedup_archive");
  });

  it("migration deduplicates keeping lowest id per unique combination", () => {
    expect(migrationSource).toContain("SELECT MIN(id) FROM work_item_assignments");
    expect(migrationSource).toContain("GROUP BY work_item_id, user_id, role");
  });

  it("migration adds the unique constraint", () => {
    expect(migrationSource).toContain("ADD CONSTRAINT uq_work_item_user_role");
    expect(migrationSource).toContain("UNIQUE (work_item_id, user_id, role)");
  });

  it("migration includes verification with zero-duplicate assertion", () => {
    expect(migrationSource).toContain("VERIFICATION");
    expect(migrationSource).toContain("Duplicates still exist");
  });

  it("migration documents entity_assignments skip (existing partial unique index)", () => {
    expect(migrationSource).toContain("entity_assignments_active_unique");
    expect(migrationSource).toContain("skip adding a redundant constraint");
  });

  // ── Rollback ──

  it("rollback drops the constraint and restores archived duplicates", () => {
    expect(rollbackSource).toContain("DROP CONSTRAINT IF EXISTS uq_work_item_user_role");
    expect(rollbackSource).toContain("INSERT INTO work_item_assignments");
    expect(rollbackSource).toContain("work_item_assignments_dedup_archive");
  });

  // ── Service layer ON CONFLICT DO NOTHING ──

  it("all workItemAssignments inserts use onConflictDoNothing", () => {
    const files = [
      "server/work-items-adapter.ts",
      "server/engineering-routes.ts",
      "server/ms-sync-routes.ts",
    ];
    for (const file of files) {
      const source = read(file);
      const insertBlocks = source.split("insert(workItemAssignments)");
      // Every insert (except the first split part) should have onConflictDoNothing
      for (let i = 1; i < insertBlocks.length; i++) {
        const nextChunk = insertBlocks[i].substring(0, 300);
        expect(nextChunk).toContain("onConflictDoNothing()");
      }
    }
  });

  it("entityAssignment inserts use onConflictDoNothing", () => {
    const routesSource = read("server/routes.ts");
    const trSource = read("server/tr-register-routes.ts");

    // routes.ts has one entityAssignments insert
    const routesInsertIdx = routesSource.indexOf("insert(entityAssignments)");
    expect(routesInsertIdx).toBeGreaterThan(-1);
    const routesChunk = routesSource.substring(routesInsertIdx, routesInsertIdx + 500);
    expect(routesChunk).toContain("onConflictDoNothing()");

    // tr-register-routes.ts has two inserts
    const trInsertBlocks = trSource.split("insert(entityAssignments)");
    expect(trInsertBlocks.length).toBeGreaterThanOrEqual(3); // 2 inserts = 3 parts
    for (let i = 1; i < trInsertBlocks.length; i++) {
      const nextChunk = trInsertBlocks[i].substring(0, 500);
      expect(nextChunk).toContain("onConflictDoNothing()");
    }
  });

  // ── Duplicate insert results in one record ──

  it("assigning same user+role twice would be silently ignored via ON CONFLICT DO NOTHING", () => {
    // The schema now has the unique constraint; the code uses onConflictDoNothing.
    // This test validates the architectural guarantee:
    // If the same (workItemId, userId, role) is inserted twice, the DB constraint
    // prevents the duplicate, and .onConflictDoNothing() suppresses the error.
    // The result is exactly one record.

    // Verify the constraint name matches what ON CONFLICT would target
    expect(tasksSchema).toContain("uq_work_item_user_role");

    // Verify all insert sites use conflict handling
    const adapter = read("server/work-items-adapter.ts");
    const adapterInserts = adapter.split("insert(workItemAssignments)").length - 1;
    const adapterConflicts = (adapter.match(/insert\(workItemAssignments\)[\s\S]*?onConflictDoNothing/g) || []).length;
    expect(adapterConflicts).toBe(adapterInserts);
  });
});
