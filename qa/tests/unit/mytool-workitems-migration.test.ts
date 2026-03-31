import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("mytool → workItems migration parity", () => {
  const migrationSource = read("migrations/20260371_migrate_mytool_to_work_items.sql");
  const schemaSource = read("shared/schema/tasks.ts");
  const mytoolSchema = read("shared/schema/mytool.ts");
  const bridgeSource = read("server/services/personal-task-bridge.ts");
  const mappingDoc = read("docs/mytool-workitems-mapping.md");
  const adapterSource = read("server/work-items-adapter.ts");
  const repoSource = read("server/repositories/work-management-repository.ts");

  // ── Migration SQL covers all fields ──

  it("data migration inserts into work_items with workstream = PERSONAL", () => {
    expect(migrationSource).toContain("'PERSONAL'::work_item_workstream");
  });

  it("data migration is idempotent (NOT EXISTS guard)", () => {
    expect(migrationSource).toContain("WHERE NOT EXISTS");
    expect(migrationSource).toContain("wi.legacy_table = 'mytool_tasks'");
    expect(migrationSource).toContain("wi.legacy_id = mt.id");
  });

  it("migration preserves legacy reference (legacy_table, legacy_id)", () => {
    expect(migrationSource).toContain("legacy_table");
    expect(migrationSource).toContain("legacy_id");
    expect(migrationSource).toContain("'mytool_tasks'");
  });

  it("migration creates OWNER assignments for migrated tasks", () => {
    expect(migrationSource).toContain("INSERT INTO work_item_assignments");
    expect(migrationSource).toContain("'OWNER'::work_item_assignment_role");
  });

  it("migration maps all 7 status values", () => {
    for (const status of ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"]) {
      expect(migrationSource).toContain(`WHEN '${status}'`);
    }
  });

  it("migration maps all 4 priority values", () => {
    for (const priority of ["low", "normal", "high", "critical"]) {
      expect(migrationSource).toContain(`WHEN '${priority}'`);
    }
  });

  // ── workItems schema has personal-task columns ──

  it("workItems table has personal-task extension columns", () => {
    expect(schemaSource).toContain("Personal-task columns");
    expect(schemaSource).toContain('bucket: text("bucket")');
    expect(schemaSource).toContain('pinnedToday: boolean("pinned_today")');
    expect(schemaSource).toContain('pinnedWeek: boolean("pinned_week")');
    expect(schemaSource).toContain('sourceEmailId: text("source_email_id")');
    expect(schemaSource).toContain('definitionOfDone: text("definition_of_done")');
    expect(schemaSource).toContain('completionNote: text("completion_note")');
    expect(schemaSource).toContain('nextStep: text("next_step")');
  });

  it("workItemWorkstreamEnum includes PERSONAL", () => {
    expect(schemaSource).toContain("'PERSONAL'");
  });

  // ── User-scoped access is preserved ──

  it("bridge service scopes reads by ownerUserId", () => {
    expect(bridgeSource).toContain("eq(workItems.ownerUserId, userId)");
    expect(bridgeSource).toContain('eq(workItems.workstream, "PERSONAL")');
    expect(bridgeSource).toContain("isNull(workItems.deletedAt)");
  });

  it("bridge service scopes updates by ownerUserId and workstream", () => {
    expect(bridgeSource).toContain("eq(workItems.ownerUserId, userId)");
    expect(bridgeSource).toContain('eq(workItems.workstream, "PERSONAL")');
  });

  it("bridge service creates OWNER assignment on task creation", () => {
    expect(bridgeSource).toContain("insert(workItemAssignments)");
    expect(bridgeSource).toContain("onConflictDoNothing()");
  });

  // ── Legacy response shape compatibility ──

  it("adapter provides getWorkItemsAsMytoolTasks for legacy shape", () => {
    expect(adapterSource).toContain("getWorkItemsAsMytoolTasks");
    expect(adapterSource).toContain("mapToMytoolStatus");
  });

  it("bridge exposes getMytoolTasksLegacy for compatibility window", () => {
    expect(bridgeSource).toContain("getMytoolTasksLegacy");
    expect(bridgeSource).toContain("getWorkItemsAsMytoolTasks");
    expect(bridgeSource).toContain("Planned removal");
  });

  it("feature flag controls read path", () => {
    expect(adapterSource).toContain("canonical_work_items_v1");
    expect(adapterSource).toContain("isWorkItemsEnabled");
  });

  // ── Repository already reads from work_items ──

  it("work-management-repository reads PERSONAL tasks from work_items", () => {
    expect(repoSource).toContain('"PERSONAL"');
    expect(repoSource).toContain("workItemToMytoolShape");
  });

  // ── Mapping documentation complete ──

  it("mapping doc covers all mytoolTasks columns", () => {
    const mytoolColumns = [
      "owner_user_id", "title", "notes", "status", "priority",
      "planned_for_date", "due_at", "start_date", "bucket",
      "pinned_today", "pinned_week", "sort_order", "is_recurring",
      "recurrence_frequency", "recurrence_interval", "blocked_reason",
      "tag", "definition_of_done", "completion_note", "next_step",
      "source_email_id", "source_email_subject", "completed_at", "deleted_at",
    ];
    for (const col of mytoolColumns) {
      expect(mappingDoc).toContain(col);
    }
  });

  it("mapping doc explains extension table is NOT needed", () => {
    expect(mappingDoc).toContain("NOT NEEDED");
    expect(mappingDoc).toContain("already columns on the `work_items` table");
  });

  it("mapping doc documents removal plan", () => {
    expect(mappingDoc).toContain("separate cleanup PR");
    expect(mappingDoc).toContain("one release window");
  });

  // ── Personal-only fields round-trip ──

  it("personal fields mapped in migration SQL", () => {
    const personalFields = [
      "bucket", "pinned_today", "pinned_week",
      "source_email_id", "source_email_subject",
      "next_step", "definition_of_done", "completion_note",
    ];
    for (const field of personalFields) {
      expect(migrationSource).toContain(field);
    }
  });
});
