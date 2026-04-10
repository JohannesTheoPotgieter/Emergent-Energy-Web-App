import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const ALL_8_TABLES = [
  "program_expense",
  "program_inflows",
  "cashflow_points",
  "finance_revenue_monthly",
  "finance_cos_monthly",
  "project_revenue_summary",
  "normalized_cost_lines",
  "normalized_revenue_lines",
];

describe("snapshotRunId FK constraints", () => {
  const financeSchema = read("shared/schema/finance.ts");
  const projectsSchema = read("shared/schema/projects.ts");
  const migrationSource = read("migrations/20260331_add_snapshot_run_id_fk.sql");
  const rollbackSource = read("migrations/20260331_add_snapshot_run_id_fk_rollback.sql");

  // ── Schema alignment: Drizzle now declares FK ──

  it("all snapshotRunId columns in finance.ts reference smartImportRuns with onDelete: set null", () => {
    const matches = financeSchema.match(
      /snapshotRunId: integer\("snapshot_run_id"\)\.references\(\(\) => smartImportRuns\.id, \{ onDelete: "set null" \}\)/g
    );
    // 8 columns in finance.ts (7 original + 1 from category_revenue_allocations)
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(8);
  });

  it("snapshotRunId in projects.ts references smartImportRuns with onDelete: set null", () => {
    expect(projectsSchema).toContain(
      'snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" })'
    );
  });

  // ── Migration safety ──

  it("migration checks for orphans before altering FK", () => {
    expect(migrationSource).toContain("snapshot_run_id_orphan_audit");
    expect(migrationSource).toContain("orphan_count");
    expect(migrationSource).toContain("NOT EXISTS");
  });

  it("migration nulls out orphaned references instead of deleting rows", () => {
    expect(migrationSource).toContain("SET snapshot_run_id = NULL");
  });

  it("migration processes all 8 tables", () => {
    for (const tbl of ALL_8_TABLES) {
      expect(migrationSource).toContain(`'${tbl}'`);
    }
  });

  it("migration drops old FK and re-adds with ON DELETE SET NULL", () => {
    expect(migrationSource).toContain("DROP CONSTRAINT");
    expect(migrationSource).toContain("ON DELETE SET NULL");
  });

  it("migration includes verification for all 8 tables", () => {
    expect(migrationSource).toContain("SNAPSHOT_RUN_ID FK VERIFICATION");
    expect(migrationSource).toContain("orphans=%");
    expect(migrationSource).toContain("fk_exists=%");
  });

  // ── Rollback ──

  it("rollback reverts to ON DELETE RESTRICT (original behavior)", () => {
    expect(rollbackSource).toContain("DROP CONSTRAINT");
    expect(rollbackSource).toContain("REFERENCES smart_import_runs(id)");
    // Should NOT contain ON DELETE SET NULL — that's the forward migration
    expect(rollbackSource).not.toContain("ON DELETE SET NULL");
  });

  it("rollback preserves orphan audit table", () => {
    expect(rollbackSource).toContain("snapshot_run_id_orphan_audit table is intentionally preserved");
  });

  // ── ON DELETE SET NULL behavior ──

  it("deleting a snapshot run would set snapshotRunId to NULL (documented in constraint)", () => {
    // The migration creates FK with ON DELETE SET NULL
    // This means: DELETE FROM smart_import_runs WHERE id = X
    // will cause all rows in all 8 tables where snapshot_run_id = X
    // to have their snapshot_run_id set to NULL (not deleted, not blocked)
    expect(migrationSource).toContain("ON DELETE SET NULL");

    // Schema matches
    expect(financeSchema).toContain('onDelete: "set null"');
    expect(projectsSchema).toContain('onDelete: "set null"');
  });
});
